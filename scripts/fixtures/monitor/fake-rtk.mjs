// Fake rtk for scripts/monitor.test.mjs: fixed output, picked by args (`gain -f json --daily` or plain `gain`).
if (process.argv.includes('json')) {
  console.log(JSON.stringify({
    summary: { total_commands: 10, total_input: 2000, total_output: 500, total_saved: 9000, avg_savings_pct: 45.5 },
    daily: [
      { date: '2026-10-19', saved_tokens: 1000 },
      { date: '2026-10-14', saved_tokens: 500 },
      { date: '2026-10-10', saved_tokens: 7777 }, // outside the 7-day window
    ],
  }));
} else {
  console.log([
    'By Command',
    '  #  Command                   Count   Saved  Total%    Time  Impact    ',
    ' 1.  rtk grep                     8    4.7M   92.2%    2.1s  ██████████',
    ' 2.  rtk git status               2    1.0K   10.0%    5ms   ░░░░░░░░░░',
  ].join('\n'));
}
