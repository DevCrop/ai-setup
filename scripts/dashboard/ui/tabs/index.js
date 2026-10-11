// The tab registry. To add a screen: write its Tab subclass, list it here, and add its <section id="v-..."> and sidebar button to index.html.
import { MonitorTab } from "./monitor.js";
import { OrchTab } from "./orch.js";
import { RouteTab } from "./route.js";
import { FeatTab } from "./feat.js";
import { EffTab } from "./eff.js";
import { PracTab } from "./prac.js";
import { DbgTab } from "./dbg.js";
import { LogTab } from "./log.js";
import { SetupTab } from "./setup.js";

export const TAB_CLASSES = [MonitorTab, OrchTab, RouteTab, FeatTab, EffTab, PracTab, DbgTab, LogTab, SetupTab];
