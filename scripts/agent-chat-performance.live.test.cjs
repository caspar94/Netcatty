"use strict";

if (!process.versions.electron) {
  require("node:test")("agent chat updates leave completed history alone", {
    skip: "run with Electron for the real chat DOM and Markdown renderer",
  }, () => {});
} else {
  const { app, BrowserWindow } = require("electron");
  const fs = require("node:fs");
  const path = require("node:path");
  const esbuild = require("esbuild");
  const temp = require("../electron/bridges/tempDirBridge.cjs");
  const root = path.resolve(__dirname, "..");
  const userData = fs.mkdtempSync(`${temp.getTempFilePath("agent-chat-performance")}-`);
  app.setPath("userData", userData);
  app.on("window-all-closed", () => {});
  let win;
  const finish = (code) => { win?.destroy(); fs.rmSync(userData, { recursive: true, force: true }); app.exit(code); };
  const watchdog = setTimeout(() => { console.error("Agent chat benchmark timed out"); finish(1); }, 90000);

  void app.whenReady().then(async () => {
    const bundleDir = path.join(userData, "bundle");
    await esbuild.build({
      stdin: {
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import ChatMessageList from './components/ai/ChatMessageList';
          import {TooltipProvider} from './components/ui/tooltip';
          import {I18nProvider} from './application/i18n/I18nProvider';
          import {warmAiMarkdownRenderer} from './components/ai/aiMarkdownWarmup';
          globalThis.AgentBench={React,createRoot,ChatMessageList,TooltipProvider,I18nProvider,warmAiMarkdownRenderer};
        `,
        resolveDir: root, loader: "tsx",
      },
      bundle: true, splitting: true, format: "esm", platform: "browser", target: "chrome148",
      outdir: bundleDir, entryNames: "bench", alias: { "react-dom/client": "react-dom/profiling" },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "import.meta": "{}" },
      plugins: [{ name: "count-completed-history-work", setup(build) {
        build.onLoad({ filter: /components\/ai\/AgentActivityGroup\.tsx$/ }, (args) => ({
          contents: fs.readFileSync(args.path, "utf8").replace(
            "  const [open, setOpen] = useState(isStreaming);",
            "  window.__activityRenders = (window.__activityRenders || 0) + 1;\n  const [open, setOpen] = useState(isStreaming);",
          ), loader: "tsx",
        }));
        build.onLoad({ filter: /components\/ai\/toolArtifacts\/terminalToolArtifact\.ts$/ }, (args) => ({
          contents: fs.readFileSync(args.path, "utf8").replace(
            "  const normalizedToolName = normalizeArtifactToolName(toolName);",
            "  window.__artifactParses = (window.__artifactParses || 0) + 1;\n  const normalizedToolName = normalizeArtifactToolName(toolName);",
          ), loader: "ts",
        }));
      } }],
    });
    const htmlPath = path.join(userData, "benchmark.html");
    fs.writeFileSync(htmlPath, '<!doctype html><body style="margin:0;background:#111"><div id="root" style="display:flex;height:800px;width:520px"></div><script type="module" src="./bundle/bench.js"></script>');
    win = new BrowserWindow({ show: true, width: 1000, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.on("console-message", (event) => { if (event.level === "error") console.log("renderer:", event.message); });
    await win.loadFile(htmlPath);
    const css = fs.readdirSync(path.join(root, "dist/assets")).find((name) => /^index-.*\.css$/.test(name));
    if (css) await win.webContents.insertCSS(fs.readFileSync(path.join(root, "dist/assets", css), "utf8"));
    for (let i = 0; i < 200; i++) {
      if (await win.webContents.executeJavaScript("Boolean(globalThis.AgentBench)")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {React,createRoot,ChatMessageList,TooltipProvider,I18nProvider,warmAiMarkdownRenderer}=AgentBench;
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      await warmAiMarkdownRenderer();
      const reactRoot=createRoot(document.getElementById('root'));
      const results=[];
      for(const scenario of ['tools-and-reasoning-history','long-markdown']) {
        let messages=[];
        if(scenario==='tools-and-reasoning-history') {
          for(let i=0;i<16;i++) {
            messages.push({id:'user-'+i,role:'user',content:'Check the service and explain the result '+i,timestamp:i});
            messages.push({id:'assistant-'+i,role:'assistant',content:'### Service '+i+'\\n\\n'+('A completed response with **status**, configuration, and recommendations.\\n\\n'.repeat(8)),thinking:'A completed reasoning trace. '.repeat(100),thinkingDurationMs:12000,timestamp:i,executionStatus:'completed',toolCalls:[{id:'call-'+i,name:'terminal_read_context',arguments:{sessionId:'terminal-'+i}}],agentActivities:[{id:'plan-'+i,type:'plan_update',status:'completed',items:[{text:'Inspect configuration',completed:true},{text:'Verify service',completed:true}]}],usage:{inputTokens:4000,outputTokens:500,totalTokens:4500}});
            messages.push({id:'tool-'+i,role:'tool',content:'',timestamp:i,toolResults:[{toolCallId:'call-'+i,toolName:'terminal_read_context',content:JSON.stringify({ok:true,sessionId:'terminal-'+i,range:'viewport',totalLines:1000,startLine:1,endLine:1000,returnedLines:1000,content:'service status and log output '.repeat(4000)})}]});
          }
        }
        messages.push({id:'live',role:'assistant',content:scenario==='long-markdown'?('### Analysis\\n\\nA paragraph with **Markdown**, \u4e2d\u6587\u5206\u6790, and \`inline code\`.\\n\\n'.repeat(250)):'Starting the current response.\\n\\n',timestamp:Date.now(),executionStatus:'running'});
        let renderMs=0,commits=0;
        const render=()=>reactRoot.render(React.createElement(I18nProvider,{locale:'en'},React.createElement(TooltipProvider,null,React.createElement(React.Profiler,{id:'chat',onRender:(_id,_phase,time)=>{renderMs+=time;commits++;}},React.createElement(ChatMessageList,{messages,isStreaming:true,activeSessionId:scenario})))));
        render();await wait(1400);
        window.__activityRenders=0;window.__artifactParses=0;renderMs=0;commits=0;
        const frameGaps=[],longTasks=[];
        const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));
        observer.observe({type:'longtask'});
        let previous=performance.now(),running=true;
        const monitor=time=>{frameGaps.push(time-previous);previous=time;if(running)requestAnimationFrame(monitor);};
        requestAnimationFrame(monitor);
        for(let i=0;i<60;i++) {
          messages=[...messages.slice(0,-1),{...messages.at(-1),content:messages.at(-1).content+'The next streamed result '+i+' is ready.\\n'}];
          render();await frame();await frame();
        }
        running=false;await frame();observer.disconnect();
        if(!document.getElementById('ai-chat-msg-live')?.textContent.includes('result 59')) throw new Error('Final streamed output was lost');
        frameGaps.sort((a,b)=>a-b);
        results.push({scenario,messages:messages.length,updates:60,completedActivityRenders:window.__activityRenders,completedArtifactParses:window.__artifactParses,reactRenderMs:Math.round(renderMs*10)/10,commits,p95FrameMs:Math.round(frameGaps[Math.floor(frameGaps.length*.95)]*10)/10,maxFrameMs:Math.round(frameGaps.at(-1)*10)/10,longTasks:longTasks.length});
        if(scenario==='tools-and-reasoning-history') {
          messages=messages.map(message=>message.id==='assistant-15'?{...message,content:'Updated completed response'}:message);
          render();await wait(100);
          if(!document.getElementById('ai-chat-msg-assistant-15')?.textContent.includes('Updated completed response')) throw new Error('Completed message edits were ignored');
          const tool=(id,label)=>({id,role:'tool',content:'',timestamp:1,toolResults:[{toolCallId:id,toolName:'terminal_read_context',content:JSON.stringify({sessionId:id,label,totalLines:1,startLine:0,endLine:0,returnedLines:1})}]});
          messages=[tool('group-tool-1','Grouped first result'),tool('group-tool-2','Grouped second result'),{id:'live',role:'assistant',content:'Done',timestamp:1}];
          window.__artifactParses=0;render();await wait(100);
          if(window.__artifactParses!==0) throw new Error('Collapsed tool group parsed hidden results');
          const groupButton=[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Tools used: 2'));
          if(!groupButton) throw new Error('Tool group header missing');
          groupButton.click();await wait(100);
          if(!document.body.textContent.includes('Grouped first result') || window.__artifactParses!==2) throw new Error('Expanding the tool group did not render results');
          messages=[tool('group-tool-1','Updated tool result'),...messages.slice(1)];
          render();await wait(100);
          if(!document.body.textContent.includes('Updated tool result')) throw new Error('Updated tool results were ignored');
        }
      }
      reactRoot.unmount();return results;
    })()`);
    console.log(JSON.stringify({ results: result }, null, 2));
    if (process.env.NETCATTY_EXPECT_STABLE_CHAT_HISTORY === "1" && result.some((row) => row.completedActivityRenders || row.completedArtifactParses)) {
      throw new Error("Streaming updated completed chat history");
    }
    clearTimeout(watchdog); finish(0);
  }).catch((error) => { console.error(error); clearTimeout(watchdog); finish(1); });
}
