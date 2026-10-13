"""Read-only source monitor; reports candidates without changing managed policy."""
import argparse
import concurrent.futures
import difflib
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import urllib.request
from urllib.parse import urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from setup import ROOT, Deployment, read_json, save_json


class Body(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ignore = 0
        self.parts = []
        self.primary = []
        self.primary_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("main", "article"):
            self.primary_depth += 1
        if tag in ("script", "style", "nav", "footer", "header"):
            self.ignore += 1

    def handle_endtag(self, tag):
        if tag in ("main", "article"):
            self.primary_depth = max(0, self.primary_depth - 1)
        if tag in ("script", "style", "nav", "footer", "header"):
            self.ignore = max(0, self.ignore - 1)

    def handle_data(self, text):
        if not self.ignore:
            self.parts.append(text)
            if self.primary_depth:
                self.primary.append(text)


def official_url(value, base):
    """Only published first-party article/doc links; no credentials or query state."""
    parsed = urlsplit(urljoin(base, value))
    hosts = {'openai.com': '/index/', 'developers.openai.com': '/blog/',
             'learn.chatgpt.com': '/docs/'}
    if (parsed.scheme != 'https' or parsed.hostname not in hosts or
            parsed.username or parsed.password or parsed.port not in (None, 443) or
            not parsed.path.startswith(hosts[parsed.hostname])):
        return None
    return urlunsplit(('https', parsed.hostname, parsed.path.rstrip('/'), '', ''))


class ArticleLinks(Body):
    def __init__(self, base):
        super().__init__()
        self.base, self.links, self.active = base, {}, None

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        if tag == 'a' and self.primary_depth and not self.ignore:
            url = official_url(dict(attrs).get('href', ''), self.base)
            if url:
                self.active = [url, []]

    def handle_data(self, text):
        super().handle_data(text)
        if self.active and not self.ignore:
            self.active[1].append(text)

    def handle_endtag(self, tag):
        if tag == 'a' and self.active:
            url, parts = self.active
            title = normalize(' '.join(parts))
            if title:
                self.links[url] = {'url': url, 'title': title}
            self.active = None
        super().handle_endtag(tag)


def article_index(text, item):
    """Return a stable discovery index, never classify headlines as policy evidence."""
    entries = {}
    if item['discovery'] == 'rss':
        if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
            raise ValueError('Unsupported feed declarations')
        for entry in ET.fromstring(text).findall('./channel/item')[:60]:
            url = official_url(entry.findtext('link', ''), item['url'])
            if url:
                entries[url] = {'url': url, 'title': normalize(entry.findtext('title', '')),
                                'published': entry.findtext('pubDate', ''),
                                'summary': normalize(entry.findtext('description', ''))}
    elif item['discovery'] == 'html':
        parser = ArticleLinks(item['url'])
        parser.feed(text)
        entries = parser.links
    elif item['discovery'] == 'markdown':
        for title, link in re.findall(r'\[([^\]]+)\]\((https://[^\s)]+)\)', text):
            url = official_url(link, item['url'])
            if url:
                entries[url] = {'url': url, 'title': normalize(title)}
    else:
        raise ValueError('Unknown article index format')
    if not entries:
        raise ValueError('No official article links; discovery is unknown')
    return sorted(entries.values(), key=lambda entry: entry['url'])


def github_body(payload):
    if isinstance(payload, list):
        selected = {"sha": payload[0]["sha"], "message": payload[0]["commit"]["message"]}
    else:
        selected = {k: payload[k] for k in ('tag_name', 'published_at', 'body')}
        selected['assets'] = [{k: a.get(k) for k in ('name', 'digest', 'browser_download_url')}
                              for a in payload.get('assets', [])]
    return json.dumps(selected, sort_keys=True)


def fetch(item):
    url = item["url"]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TRACE-Setup-source-monitor/1"})
        with urllib.request.urlopen(req, timeout=25) as response:
            data = response.read(4_000_001)
            if len(data) > 4_000_000:
                raise ValueError("Response exceeds monitor limit")
            text = data.decode("utf-8")
            articles = article_index(text, item) if item.get('discovery') else None
            if url.startswith("https://api.github.com/"):
                text = github_body(json.loads(text))
            if articles is not None:
                text = json.dumps(articles, ensure_ascii=False, sort_keys=True)
            elif "text/html" in response.headers.get("Content-Type", ""):
                body = Body()
                body.feed(text)
                text = " ".join(body.primary or body.parts)
            normalized = normalize(text)
            if len(normalized) < 50:
                raise ValueError("Empty or unexpectedly short body")
            if any(marker in normalized.lower() for marker in ("verify you are human", "just a moment...", "access denied")):
                raise ValueError("Access challenge instead of document")
            result = {"id": item["id"], "url": url, "status": "fetched",
                    "sha256": hashlib.sha256(normalized.encode()).hexdigest(),
                    "body": normalized}
            if articles is not None:
                result['articles'] = articles
            return result
    except Exception as exc:
        return {"id": item["id"], "url": url, "status": "error", "error": type(exc).__name__}


def normalize(text):
    return re.sub(r'\s+', ' ', text.translate(str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"'}))).strip()


def resolve_candidate(state, source_id, expected_sha, reason):
    pending = read_json(state / 'source-pending.json', {})
    candidate = pending.get(source_id)
    if not candidate or candidate['sha256'] != expected_sha or not reason.strip():
        raise ValueError('Candidate changed, missing, or review reason empty')
    del pending[source_id]
    save_json(state / 'source-pending.json', pending)
    # One current review record per source, not a growing archive.
    reviews = read_json(state / 'source-reviews.json', {})
    reviews[source_id] = {'sha256': expected_sha, 'reason': reason,
                          'reviewed_at': datetime.now(timezone.utc).isoformat()}
    save_json(state / 'source-reviews.json', reviews)
    report = read_json(state / 'source-report.json', {})
    if report:
        report['pending'] = list(pending.values())
        report['review_decisions'] = reviews
        save_json(state / 'source-report.json', report)


def check(state, items, fetcher=fetch):
    if not items or len({item['id'] for item in items}) != len(items):
        raise ValueError('Monitor requires nonempty, unique source IDs')
    previous = read_json(state / "source-status.json", {})
    previous = {k: v for k, v in previous.items() if k in {item['id'] for item in items}}
    pending_path = state / 'source-pending.json'
    pending = read_json(pending_path, {})
    # Upgrade from v1.0: retain unresolved candidates in the last report.
    if not pending_path.exists():
        pending = {r['id']: r for r in read_json(state / 'source-report.json', {}).get('results', [])
                   if r.get('change') == 'candidate'}
    # A watch-list change is not a semantic resolution of an old candidate.
    active_ids = {item['id'] for item in items}
    for key, value in pending.items():
        if key not in active_ids:
            value['monitor_retired'] = True
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for row in pool.map(fetcher, items):
            if row["status"] == "fetched":
                old = previous.get(row["id"])
                if 'articles' in row:
                    known = (old or {}).get('articles')
                    by_url = {entry['url']: entry for entry in known or []}
                    row['article_baseline'] = known is None
                    row['new_articles'] = [entry for entry in row['articles'] if entry['url'] not in by_url]
                    row['changed_articles'] = [entry for entry in row['articles']
                                               if entry['url'] in by_url and entry != by_url[entry['url']]]
                row["change"] = "baseline" if not old else "unchanged" if old["sha256"] == row["sha256"] else "candidate"
                if old and normalize(old['body']) == normalize(row['body']):
                    row['change'] = 'unchanged'
                if old and row["change"] == "candidate":
                    row["diff_excerpt"] = "\n".join(difflib.unified_diff(
                        old["body"].split(". "), row["body"].split(". "),
                        fromfile="previous", tofile="current", lineterm=""))[:12000]
                    prior = pending.get(row['id'])
                    pending[row['id']] = {k: v for k, v in row.items() if k != 'body'}
                    pending[row['id']]['first_detected_at'] = (prior or {}).get('first_detected_at', datetime.now(timezone.utc).isoformat())
                    if prior and prior.get('sha256') != row['sha256']:
                        pending[row['id']]['earlier_unreviewed_diff'] = prior.get('earlier_unreviewed_diff', prior.get('diff_excerpt', ''))[:12000]
                # Collection is not semantic acceptance. Runtime application is
                # separate and must stay inside the host's recorded authorization.
                previous[row["id"]] = {"sha256": row["sha256"], "body": row.pop("body")}
                if 'articles' in row:
                    previous[row['id']]['articles'] = row['articles']
            results.append(row)
    now = datetime.now(timezone.utc).isoformat()
    report = {"checked_at": now, "results": results, 'pending': list(pending.values()),
              'last_policy_applied_at': read_json(state / 'installed.json', {}).get('applied_at'),
              "limit": "Hash change is a review candidate, not a verified semantic or policy change."}
    save_json(state / "source-status.json", previous)
    save_json(pending_path, pending)
    save_json(state / "source-report.json", report)
    if all(r["status"] == "fetched" for r in results):
        save_json(state / "source-success.json", {"last_success": now})
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path)
    parser.add_argument('--resolve', help='Resolve a reviewed source ID; never applies policy')
    parser.add_argument('--expected-sha')
    parser.add_argument('--reason')
    args = parser.parse_args()
    state = args.state or Deployment().state
    if args.resolve:
        if not args.expected_sha or not args.reason:
            parser.error('--resolve requires --expected-sha and --reason')
        resolve_candidate(state, args.resolve, args.expected_sha, args.reason)
        print(json.dumps({'status': 'review-recorded', 'id': args.resolve}))
        return 0
    registry = read_json(ROOT / "references/registry.json")
    items = [x for x in registry["sources"] if x.get("monitor")]
    for s in read_json(ROOT / "versions.lock.json")["skills"]:
        items.append({"id": "upstream-" + s["name"], "url": f'https://api.github.com/repos/{s["repository"]}/commits?per_page=1'})
    report = check(state, items)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if any(r['status'] == 'error' for r in report['results']) else 0


if __name__ == "__main__":
    sys.exit(main())
