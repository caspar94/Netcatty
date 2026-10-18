"use strict";

if (!process.versions.electron) {
  require("node:test")("top tab switches avoid re-rendering the complete bar", {
    skip: "run with Electron for real DOM and React profiling",
  }, () => {});
} else {
  const { app, BrowserWindow } = require("electron");
  const fs = require("node:fs");
  const path = require("node:path");
  const esbuild = require("esbuild");
  const temp = require("../electron/bridges/tempDirBridge.cjs");
  const root = path.resolve(__dirname, "..");
  const userData = fs.mkdtempSync(`${temp.getTempFilePath("top-tabs-performance")}-`);
  app.setPath("userData", userData);
  let win;
  const finish = (code) => { win?.destroy(); fs.rmSync(userData, { recursive: true, force: true }); app.exit(code); };
  const watchdog = setTimeout(() => { console.error("Top tabs benchmark timed out"); finish(1); }, 45_000);

  void app.whenReady().then(async () => {
    const bundle = await esbuild.build({
      stdin: {
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {TopTabs} from './components/TopTabs';
          import {activeTabStore} from './application/state/activeTabStore';
          import {TooltipProvider} from './components/ui/tooltip';
          export {React,createRoot,TopTabs,activeTabStore,TooltipProvider};
        `,
        resolveDir: root, loader: "tsx",
      },
      bundle: true, format: "iife", globalName: "Bench", platform: "browser", target: "chrome148", write: false,
      alias: { "react-dom/client": "react-dom/profiling" },
      // These optional sync adapters are never used by this isolated UI.
      external: ["https", "http", "@smithy/node-http-handler"],
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta": "{}" },
      plugins: [{ name: "count-bar-renders", setup(build) {
        build.onLoad({ filter: /components\/TopTabs\.tsx$/ }, (args) => ({
          contents: fs.readFileSync(process.env.NETCATTY_TOP_TABS_BASELINE || args.path, "utf8").replace(
            "  const { t } = useI18n();",
            "  window.__barRenders = (window.__barRenders || 0) + 1;\n  const { t } = useI18n();",
          ), loader: "tsx",
        }));
      } }],
    });
    win = new BrowserWindow({ show: true, width: 1400, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.on("console-message", (event) => console.log("renderer:", event.message));
    const htmlPath = path.join(userData, "benchmark.html");
    fs.writeFileSync(htmlPath, "<!doctype html><body style='margin:0;background:#111'><div id='root'></div>");
    await win.loadFile(htmlPath);
    const css = fs.readdirSync(path.join(root, "dist/assets")).find((name) => /^index-.*\.css$/.test(name));
    if (css) await win.webContents.insertCSS(fs.readFileSync(path.join(root, "dist/assets", css), "utf8"));
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {React,createRoot,TopTabs,activeTabStore,TooltipProvider}=Bench;
      const noop=()=>{};
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      const reactRoot=createRoot(document.getElementById('root'));
      const results=[];
      for(const count of [20,100]) {
        const hosts=Array.from({length:count},(_,i)=>({id:'host-'+i,label:'Server '+i,hostname:'test.invalid',username:'test',port:22,protocol:'ssh',tags:[],os:'linux'}));
        const sessions=hosts.map((h,i)=>({id:'session-'+i,hostId:h.id,status:'connected',hostLabel:h.label,hostname:h.hostname,username:h.username,port:h.port,protocol:h.protocol}));
        const props={theme:'dark',themePreference:'dark',hosts,sessions,orphanSessions:sessions,workspaces:[],logViews:[],orderedTabs:sessions.map(s=>s.id),draggingSessionId:null,isMacClient:true,externalMcpEnabled:true,windowOpacity:1,showSftpTab:true,showHostTreeSidebar:true,switchTabKeyBinding:null,tabDoubleClickBehavior:'none',editorTabs:[],pluginViewTabs:[],hostById:new Map(hosts.map(h=>[h.id,h]))};
        for(const key of ['onCloseSession','onRenameSession','onCopySession','onCopySessionToNewWindow','onRenameWorkspace','onCopyWorkspace','onCloseWorkspace','onCloseLogView','onCloseTabsBatch','onOpenQuickSwitcher','onThemeChange','onOpenSettings','onToggleExternalMcp','setWindowOpacity','onStartSessionDrag','onEndSessionDrag','onReorderTabs','onRemoveSessionFromWorkspace','onClosePluginViewTab','onRequestCloseEditorTab']) props[key]=noop;
        let renderMs=0,commits=0;
        activeTabStore.setActiveTabId(sessions[0].id);
        reactRoot.render(React.createElement(TooltipProvider,null,React.createElement(React.Profiler,{id:'bar',onRender:(_id,_phase,time)=>{renderMs+=time;commits++;}},React.createElement(TopTabs,props))));
        await wait(700);
        window.__barRenders=0;renderMs=0;commits=0;
        const frameGaps=[];let previous=performance.now();let running=true;
        const monitor=time=>{frameGaps.push(time-previous);previous=time;if(running) requestAnimationFrame(monitor);};
        requestAnimationFrame(monitor);
        for(let i=1;i<=60;i++) {activeTabStore.setActiveTabId(sessions[i%count].id);await frame();await frame();}
        running=false;await frame();
        const selected=document.querySelector('[data-tab-id="'+sessions[60%count].id+'"]');
        if(!selected || selected.dataset.state!=='active') throw new Error('Expected active terminal tab missing');
        if(!selected.textContent.includes('Server '+60%count)) throw new Error('Expected terminal label missing');
        const beforeVault=window.__barRenders;
        const switchRenderMs=renderMs, switchCommits=commits;
        activeTabStore.setActiveTabId('vault');await wait(300);
        const afterVault=window.__barRenders;
        activeTabStore.setActiveTabId(sessions[0].id);await wait(400);
        if(afterVault<=beforeVault || window.__barRenders<=afterVault) throw new Error('Host tree chrome failed to follow root/work surface changes');
        frameGaps.sort((a,b)=>a-b);
        results.push({tabs:count,switches:60,barRenders:beforeVault,reactRenderMs:Math.round(switchRenderMs*10)/10,commits:switchCommits,p95FrameMs:Math.round(frameGaps[Math.floor(frameGaps.length*.95)]*10)/10,maxFrameMs:Math.round(frameGaps.at(-1)*10)/10});
      }
      reactRoot.unmount();return results;
    })()`);
    console.log(JSON.stringify({ results: result, gpu: app.getGPUFeatureStatus() }, null, 2));
    // Scroll-edge indicators may update when the active tab is auto-scrolled.
    if (process.env.NETCATTY_EXPECT_STABLE_TAB_BAR === "1" && result.some((row) => row.barRenders > 6)) {
      throw new Error("Terminal switches re-rendered the full tab bar");
    }
    clearTimeout(watchdog); finish(0);
  }).catch((error) => { console.error(error); clearTimeout(watchdog); finish(1); });
}
