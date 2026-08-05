/**
 * The dev inbox's UI: one self-contained document, no build step, no dependencies. It's
 * dressed as AOL 4.0 on Windows 98 because a local mail client that looks nothing like
 * production mail is a feature — you can never mistake a screenshot of this for the real
 * thing.
 *
 * Window chrome comes from XP.css (vendored in inbox_theme.ts); the AOL furniture on top of
 * it — the coloured toolbar bands, the mailbox header, the folder tabs — is ours, because no
 * OS framework ships those.
 */

import { THEME_CSS } from "./inbox_theme.js"

/**
 * The Postboi mark, inlined as a data URI — the tab icon, and the badge in every title
 * bar and on the sign-on. Copied from static/favicon.svg; the published package has no
 * static directory to serve it from.
 */
const FAVICON =
	"data:image/svg+xml,%3Csvg%20width%3D%22664%22%20height%3D%22664%22%20viewBox%3D%22-76%20-76%20664%20664%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%20%3Cpath%20d%3D%22M68.3939%20168.189L68.3751%20168.72C56.7497%20176.365%2028.1454%20195.529%2025.0885%20209.716C21.192%20227.793%2049.1638%20244.048%2064.0193%20248.609C63.4697%20259.384%2063.0556%20277.148%2064.968%20287.805C51.0574%20290.624%2039.5035%20295.187%2031.4207%20307.82C14.5473%20334.193%2022.5963%20369.062%2049.2014%20385.517C56.7911%20390.265%2061.3426%20391.191%2069.768%20393.42C69.768%20444.235%20139.294%20508.235%20239.059%20510.118C338.824%20512%20421.921%20443.237%20431.059%20393.412C502.84%20388.804%20506.628%20299.158%20448.185%20287.251C451.509%20272.03%20452.36%20256.371%20450.696%20240.88C450.018%20234.704%20445.41%20227.947%20447.27%20223.786C455.074%20206.312%20451.95%20180.459%20447.338%20163.343C434.677%20116.336%20406.532%2090.6687%20371.302%2059.6648C356.703%2046.8178%20347.121%2034.0163%20328.976%2024.1441C289.145%202.47405%20245.056%20-1.48981%20201.947%2010.2346C154.414%2023.4762%20114.045%2054.9714%2089.6344%2097.8536C77.3953%20119.356%2069.3652%20143.371%2068.3939%20168.189Z%22%20fill%3D%22%230F1C41%22%2F%3E%20%3Cpath%20d%3D%22M259.765%20350.118C257.882%20363.294%20223.153%20378.787%20212.002%20360.205C209.292%20355.728%20208.558%20350.33%20209.981%20345.293C213.806%20331.236%20228.578%20323.482%20242.677%20325.848C253.933%20327.737%20261.647%20336.941%20259.765%20350.118Z%22%20fill%3D%22%23F88428%22%2F%3E%20%3Cpath%20d%3D%22M382.931%20206.464C384.968%20210.523%20381.768%20230.997%20384.102%20236.757C396.808%20268.104%20407.744%20293.006%20405.467%20328.039C405.29%20330.786%20407.202%20334.861%20409.943%20336.37C427.283%20345.914%20423.692%20308.011%20439.861%20306.756C465.269%20304.06%20475.641%20336.713%20461.681%20354.527C452.695%20366.002%20445.772%20368.185%20432.102%20370.493C429.757%20367.38%20425.228%20359.685%20421.324%20360.34C412.955%20369.443%20408.418%20411.819%20391.096%20429.908C367.996%20454.032%20347.117%20468.88%20315.445%20480.234C268.04%20497.225%20218.327%20500.756%20171.867%20479.057C148.334%20468.854%20124.842%20454.887%20107.713%20435.363C83.8557%20408.536%2086.991%20374.047%2085.9783%20341.249C85.0635%20311.741%2090.2667%20287.11%2092.3787%20258.482C114.026%20255.485%20119.346%20254.017%20139.765%20246.468C138.764%20248.746%20137.8%20251.039%20136.866%20253.346C135.545%20256.685%20135.285%20257.723%20136.588%20260.751L138.308%20261.038C146.124%20257.575%20175.838%20247.787%20178.428%20245.364L178.493%20243.202C177.1%20239.807%20173.666%20237.171%20170.873%20234.618C178.805%20234.647%20184.983%20234.719%20192.862%20233.878L192.592%20247.311C219.935%20247.071%20255.921%20232.44%20278.171%20217.064L271.684%20236.376C295.413%20231.261%20319.691%20227.567%20342.942%20221.005C355.833%20217.366%20369.021%20211.486%20381.403%20206.187L382.931%20206.464ZM301.832%20376.713C278.547%20394.038%20260.413%20404.775%20229.655%20400.242C217.559%20398.45%20206.039%20393.884%20195.995%20386.9C191.884%20384.005%20186.899%20378.215%20182.043%20378.475C175.609%20387.615%20190.642%20423.64%20195.562%20433.259C204.925%20447.941%20217.872%20460.85%20235.494%20464.675C277.218%20473.729%20299.226%20429.799%20305.254%20395.759C306.413%20389.201%20309.237%20379.804%20301.832%20376.713ZM271.609%20339.789C255.786%20289.622%20182.792%20315.676%20194.737%20361.579C202.557%20391.614%20282.353%20384%20271.609%20339.789ZM323.471%20280.553C315.983%20284.478%20311.809%20289.404%20309.663%20297.735C305.522%20313.818%20312.155%20350.775%20325.489%20350.446C338.823%20350.117%20346.372%20284.804%20323.471%20280.553ZM158.178%20280.733C132.861%20291.75%20139.11%20347.683%20158.893%20349.246C166.103%20346.02%20170.896%20341.404%20173.196%20333.701C178.361%20316.409%20180.074%20286.409%20158.178%20280.733ZM343.688%20262.393C352.9%20256.917%20336.038%20232.49%20314.049%20233.772C306.278%20238.797%20306.041%20242.327%20303.594%20251.289C321.728%20251.403%20325.162%20250.91%20340.149%20261.352L343.688%20262.393Z%22%20fill%3D%22%23FCC58F%22%2F%3E%20%3Cpath%20d%3D%22M232.975%20437.332C246.822%20435.984%20255.835%20437.479%20269.026%20441.236C264.588%20446.375%20263.473%20447.708%20258.026%20451.841C251.005%20453.999%20223.436%20453.942%20226.199%20442.17C228.364%20439.211%20229.73%20438.827%20232.975%20437.332Z%22%20fill%3D%22%23E04A6E%22%2F%3E%20%3Cpath%20d%3D%22M119.36%20355.277C126.82%20353.057%20133.485%20354.181%20140.405%20357.536C152.798%20363.54%20146.245%20376.615%20137.412%20378.353C129.95%20379.821%20122.561%20380.55%20116.706%20376.471C109.993%20371.793%20106.075%20359.23%20119.36%20355.277Z%22%20fill%3D%22%23F88428%22%2F%3E%20%3Cpath%20d%3D%22M355.765%20353.882C370.824%20353.882%20383.075%20379.154%20360.949%20378.753C338.824%20378.353%20332.853%20368.342%20334.897%20362.994C336.941%20357.647%20340.706%20353.882%20355.765%20353.882Z%22%20fill%3D%22%23F88428%22%2F%3E%20%3Cpath%20d%3D%22M89.0997%20152.275C98.6357%20121.566%20105.695%20102.135%20127.311%2077.2893C154.094%2046.5083%20197.561%2025.1854%20238.246%2022.7786C264.294%2021.2377%20299.118%2029.1564%20321.777%2042.6563C329.051%2046.9891%20338.056%2055.2078%20344.584%2060.9855C344.426%2062.0784%20344.223%2063.4853%20343.978%2065.2057C348.029%2076.4035%20353.657%2086.7079%20356.778%2098.2858C360.057%20110.451%20360.328%20123.204%20358.961%20135.672C358.517%20139.733%20357.113%20146.317%20353.578%20148.8C331.931%20137.956%20297.043%20123.309%20272.93%20123.096C281.529%20114.918%20288.166%20107.384%20289.22%2095.0328C290.459%2081.9801%20286.348%2068.984%20277.828%2059.0173C257.781%2035.2842%20227.957%2036.8142%20205.753%2055.4115C186.858%2071.2406%20187.2%20102.518%20203.453%20120.116C178.741%20121.775%20151.752%20127.447%20128.742%20136.741C117.644%20141.225%2099.9346%20149.561%2089.0997%20152.275Z%22%20fill%3D%22%238DB7D5%22%2F%3E%20%3Cpath%20d%3D%22M215.963%20135.277C268.149%20129.918%20349.802%20155.829%20387.686%20191.482C373.324%20188.181%20357.237%20186.536%20342.382%20183.3C310.442%20176.343%20274.124%20167.503%20241.713%20164.129C233.435%20162.617%20219.087%20162.461%20210.549%20162.202C158.645%20160.621%20113.905%20173.945%2065.7472%20191.06C113.811%20154.615%20155.219%20139.779%20215.963%20135.277Z%22%20fill%3D%22%23346696%22%2F%3E%20%3Cpath%20d%3D%22M344.584%2060.9855C382.532%2093.6552%20427.272%20132.896%20431.5%20186.19C431.921%20191.535%20433.284%20205.359%20430.295%20209.175C418.843%20203.351%20401.047%20176.297%20385.525%20168.839C384.825%20168.504%20352.592%20147.761%20353.578%20148.8C357.113%20146.317%20358.517%20139.733%20358.961%20135.672C360.328%20123.204%20360.057%20110.451%20356.778%2098.2858C353.657%2086.7078%20338.824%2065.8823%20344.584%2060.9855Z%22%20fill%3D%22%23588CB5%22%2F%3E%20%3Cpath%20d%3D%22M67.7048%20306.415C70.2159%20309.199%2069.7152%20364.109%2069.8093%20370.599C62.6451%20368.363%2059.2794%20366.251%2053.2258%20362.095C36.4653%20347.559%2037.5006%20322.281%2056.5726%20310.116C59.5768%20308.201%2064.2338%20307.25%2067.7048%20306.415Z%22%20fill%3D%22%23FCC58F%22%2F%3E%20%3Cpath%20d%3D%22M218.353%2065.8824C218.353%2065.8824%20244.706%2037.6471%20272.746%2067.4902L242.824%2080.9412L218.353%2065.8824Z%22%20fill%3D%22%23FEFDFD%22%2F%3E%20%3Cpath%20d%3D%22M242.824%2094.1176L264.607%20111.245C242.824%20128%20214.588%20111.245%20214.588%20111.245L242.824%2094.1176Z%22%20fill%3D%22%23FDC005%22%2F%3E%20%3Cpath%20d%3D%22M252.235%2088.4706L276.706%2077.1765C276.706%2077.1765%20286.118%2092.2353%20272.941%20103.529L252.235%2088.4706Z%22%20fill%3D%22%23FEFDFD%22%2F%3E%20%3Cpath%20d%3D%22M208.941%20101.647C208.941%20101.647%20201.412%2086.5882%20211.283%2074.8412L233.412%2088.4706L208.941%20101.647Z%22%20fill%3D%22%23FEFDFD%22%2F%3E%20%3C%2Fsvg%3E"

const CSS = `
* { box-sizing: border-box }
body {
	margin: 0; padding: 0; height: 100vh; overflow: hidden;
	background: #0a0b0c;
	font: 12px "MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif;
	color: #000;
	-webkit-font-smoothing: none;
}
button { font: 12px "MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif }

/*
 * XP.css sizes every button for a dialog — 75x23 minimum. The AOL furniture is full of
 * things that aren't dialog buttons (icon tiles, nav arrows, folder tabs), so they opt out.
 */
#toolbar button, #nav button, #folders button, #tabs button, #taskbar button, .aolbtn, .grip {
	min-width: 0; min-height: 0; box-sizing: border-box;
}
#nav .rnd { width: 26px; height: 22px; padding: 0 }
/* XP.css supplies the bevels; these are the two insets it does not name. */
.sunken { box-shadow: inset -1px -1px #fff, inset 1px 1px grey, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a }
.thin-sunken { border: 1px solid; border-color: #808080 #fff #fff #808080 }
/*
 * XP.css draws the window's 3px blue frame as inset shadows *over* the content box, which
 * is why its own padding is "0 0 3px" — no top, no sides. Adding padding there pushes the
 * title bar inward and lets the silver window background show in the gap, worst at the
 * rounded top corners. Sides are padded here instead and the title bar spans back out over
 * them, so it stays full-bleed under the frame the way the real one is.
 */
.window { padding: 0 3px 3px; display: flex; flex-direction: column; min-height: 0 }
/*
 * Left to XP.css. Its caption buttons are 21px pixel-art tiles that carry their own blue
 * edging, drawn for the 21px bar it sets — override the height and the sprite stops
 * lining up with the gradient, which shows as a grey seam behind the controls.
 */
.title-bar { flex: none; margin: 0 -3px }
.title-bar.dim { background: linear-gradient(90deg, #7f7f7f, #b5b5b5) }

#screen {
	position: relative; height: 100%; overflow: hidden;
	background: #3a6ea5; display: flex; flex-direction: column;
}

/* ---- Title bars, shared by the app window and every child window ---- */
.title-bar-text { display: flex; align-items: center; gap: 5px; margin-right: 12px }

/* ---- The AOL application window ---- */
#aol { flex: 1; display: flex; flex-direction: column; min-height: 0; background: #c0c0c0; margin: 2px 2px 0 }
#menubar { display: flex; gap: 2px; padding: 1px 4px; background: #c0c0c0 }
#menubar span { padding: 2px 7px }
#menubar u { text-decoration: underline }

/* The toolbar: chunky icon-over-label buttons in coloured bands, AOL's signature. */
#toolbar { display: flex; align-items: stretch; background: #c0c0c0; border-top: 1px solid #dfdfdf; border-bottom: 2px solid #808080 }
.band { display: flex; align-items: stretch; padding: 3px 2px; gap: 1px; border-right: 1px solid #808080 }
.band.b1 { background: #b8c4dc }
.band.b2 { background: #86c0c0 }
.band.b3 { background: #a89ec8 }
.band.b4 { background: #7fb0d8 }
.band.b5 { flex: 1; background: linear-gradient(90deg, #2a4a8a, #14284f); justify-content: flex-end; align-items: center; padding-right: 10px; border-right: 0 }
.tb {
	display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 1px;
	min-width: 58px; padding: 3px 5px 2px; background: transparent; cursor: pointer;
	font: 11px "MS Sans Serif", Tahoma, sans-serif; border: 2px solid transparent;
}
.tb:hover { border-color: #fff #808080 #808080 #fff }
.tb:active { border-color: #808080 #fff #fff #808080; padding: 4px 4px 1px 6px }
.tb .ico { font-size: 17px; line-height: 18px }
.tb.inert { cursor: default }
.tb.inert:hover { border-color: transparent }
.tb.on { border-color: #808080 #fff #fff #808080; background: rgba(255,255,255,.35) }

/* Navigation strip: arrows, Find dropdown, the address field, Go / Keyword. */
#nav { display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: #c0c0c0; border-bottom: 2px solid #808080 }
#nav .rnd {
	width: 26px; height: 22px; background: #c0c0c0; cursor: default; color: #000080;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
	font-size: 12px; line-height: 14px;
}
#nav .pill {
	padding: 3px 10px; background: #c0c0c0; cursor: default;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
#address { flex: 1; background: #fff; padding: 3px 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis }

/* The MDI workspace child windows float in. */
#workspace { flex: 1; position: relative; background: #6a6a6a; min-height: 0; padding: 10px; overflow: hidden }
.child { display: flex; flex-direction: column; background: #c0c0c0; min-height: 0 }
/*
 * Real MDI child windows: dragged by the title bar, resized from the edges, maximised,
 * minimised to the taskbar, raised on click. Floating over each other the way AOL did is
 * only tolerable once you can actually move them — which is also what lets the reader be
 * as big as the mail needs.
 */
.child { position: absolute }
/* "#reader.open" sets display:flex and outranks a bare ".child.min" on specificity, so
   minimising has to be spelled out at least as strongly or the window never hides. */
.child.min, .child.closed, #reader.open.min, #reader.open.closed { display: none }
.child .title-bar { cursor: default; user-select: none }
.child.max .grip, .child.max .edge { display: none }
.grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 6 }
/* The Win95 hatch: three stepped highlights, drawn with a repeating gradient. */
.grip::after {
	content: ""; position: absolute; inset: 3px;
	background: repeating-linear-gradient(135deg, #fff 0 2px, #808080 2px 4px, transparent 4px 6px);
}
.edge { position: absolute; z-index: 5 }
.edge-r { top: 0; bottom: 0; right: -2px; width: 6px; cursor: ew-resize }
.edge-b { left: 0; right: 0; bottom: -2px; height: 6px; cursor: ns-resize }
/* An iframe eats mousemove, so a drag that crosses one would stall halfway. */
.dragging iframe { pointer-events: none }

/* Mailbox header: the wordmark and the security reminder. */
#mbhead { display: flex; align-items: flex-start; gap: 12px; padding: 7px 10px; background: #fff }
#mbhead .mark { display: flex; align-items: center; gap: 8px; color: #000080 }
#mbhead .mark span { font: italic bold 21px Georgia, "Times New Roman", serif; letter-spacing: -.5px }
#mbhead .reminder { flex: 1; line-height: 1.45; padding-top: 4px }
/* The one thing everybody remembers. */
#gotmail { display: none; align-items: center; gap: 8px; margin-bottom: 5px }
#gotmail.on { display: flex }
#gotmail .shout { font: italic bold 17px Arial, sans-serif; color: #000080 }
#gotmail .shout b { color: #d07000 }
@keyframes wave { 0%, 100% { transform: rotate(0) } 50% { transform: rotate(-11deg) } }
/* Only the flag waves — a wobbling mailbox reads as a rendering bug, not as delight. */
#mbhead .flag { animation: wave 1.5s ease-in-out infinite; transform-box: view-box; transform-origin: 28px 30px }

/* Folder tabs — New Mail / Old Mail / Sent Mail. */
#folders { display: flex; gap: 3px; padding: 4px 10px 0; background: #003399 }
#folders button {
	padding: 5px 16px 6px; cursor: pointer; background: #7f9fcf; color: #eaeef8; font-weight: bold;
	border: 0; border-radius: 7px 7px 0 0;
}
#folders button.on { background: #fff; color: #003399 }
#listwrap { padding: 0 10px 6px; background: #003399; flex: 1; min-height: 0; display: flex }
#list { flex: 1; background: #fff; overflow: auto; min-height: 0 }

table { width: 100%; border-collapse: collapse; font: 12px "MS Sans Serif", Tahoma, sans-serif }
tbody td { padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
tbody tr { cursor: pointer }
tbody tr.unread td { font-weight: bold }
tbody tr.on td { background: #000080; color: #fff }
td.flag { width: 26px; text-align: center }
td.when { width: 88px }
td.who { width: 34% }
#empty { padding: 26px; text-align: center; color: #808080; line-height: 1.6 }

/* The action row along the bottom of the mailbox window. */
#actions { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #c0c0c0 }
#actions .spacer { flex: 1 }
.aolbtn {
	min-width: 92px; padding: 4px 14px; cursor: pointer; background: #b6c6de; color: #000080; font-weight: bold;
	border: 2px solid; border-color: #fff #6a7a94 #6a7a94 #fff;
}
.aolbtn:active { border-color: #6a7a94 #fff #fff #6a7a94 }
.aolbtn[disabled] { color: #808080; cursor: default }

/* The reader opens as its own child window, the way AOL opened mail. */
#reader { display: none }
#reader.open { display: flex }
#head { padding: 7px 9px; background: #c0c0c0; border-bottom: 1px solid #808080 }
#head .subject { font-weight: bold; font-size: 13px; margin-bottom: 3px }
#head dl { display: grid; grid-template-columns: max-content 1fr; gap: 1px 8px; margin: 0 }
#head dt { color: #000080; font-weight: bold }
#head dd { margin: 0; overflow: hidden; text-overflow: ellipsis }
#tabs { display: flex; gap: 3px; padding: 5px 8px 0; background: #c0c0c0 }
#tabs button { padding: 4px 13px; cursor: pointer; background: #7f9fcf; color: #eaeef8; font-weight: bold; border: 0; border-radius: 7px 7px 0 0 }
#tabs button.on { background: #fff; color: #003399 }
#pane { flex: 1; margin: 0 8px 8px; background: #fff; min-height: 0; overflow: auto }
#pane iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff }
#pane pre { margin: 0; padding: 10px; font: 12px ui-monospace, "Courier New", monospace; white-space: pre-wrap; word-wrap: break-word }
#pane .files { padding: 10px }
#pane .files a { display: block; margin-bottom: 5px; color: #0000ee }
#blank { display: flex; height: 100%; align-items: center; justify-content: center; color: #808080; text-align: center; line-height: 1.7 }
#readerfoot { display: flex; align-items: center; gap: 10px; padding: 0 10px 10px; background: #c0c0c0 }
#readerfoot #r-count { flex: 1; text-align: center; font-weight: bold; color: #17265c }

/* ---- Taskbar and Start menu ---- */
/* The taskbar is Luna's, not 98's — everything else moved to XP.css and this was the last
   thing still wearing grey. */
#taskbar {
	display: flex; align-items: center; gap: 4px; padding: 2px 4px; margin: 0;
	/* Always on top, and windows can't be dragged under it — same as the real one. */
	position: relative; z-index: 500; height: 30px; flex: none;
	background: linear-gradient(180deg, #3f8cf3 0%, #245edb 9%, #245edb 88%, #1941a5 100%);
	border-top: 1px solid #6ba4f8; color: #fff;
}
.title-bar-text .mark, #taskbar .mark { width: 14px; height: 14px; flex: none; vertical-align: -3px; margin-right: 4px }
#intrologo img { width: 34px; height: 34px; vertical-align: -7px; margin-right: 8px }
/*
 * Drawn rather than bitmapped. The faithful recreations slice Microsoft's actual XP theme
 * PNGs, which is fine in a CodePen but not in something published to npm — so the sheen,
 * the curve and the text shadow are matched in CSS instead.
 */
#start {
	display: flex; align-items: center; gap: 5px; padding: 0 22px 2px 8px; margin: 0 2px 0 0;
	height: 30px; flex: none; cursor: pointer; border: 0;
	font: italic bold 17px "Franklin Gothic Medium", "Segoe UI", Tahoma, Arial, sans-serif;
	color: #fff; text-shadow: 1px 2px 2px rgb(69,76,16), 0 0 3px rgb(69,76,16);
	border-radius: 0 14px 14px 0;
	background:
		linear-gradient(180deg, rgba(255,255,255,.45) 0%, rgba(255,255,255,.08) 22%, rgba(255,255,255,0) 46%),
		linear-gradient(180deg, #59a94b 0%, #3f9134 14%, #338a28 45%, #2b7d20 72%, #37962a 88%, #55b23f 100%);
	box-shadow: inset -2px 0 4px rgba(0,0,0,.28), inset 0 -2px 3px rgba(0,0,0,.25);
}
#start:hover { filter: brightness(1.08) }
#start.on { background: linear-gradient(180deg, #2b7d20 0%, #338a28 55%, #46a334 100%); box-shadow: inset 2px 2px 5px rgba(0,0,0,.4) }
#start .flag { flex: none; filter: drop-shadow(1px 1px 1px rgba(0,0,0,.45)) }
#start.on { background: linear-gradient(180deg, #227d22 0%, #2c8b2c 55%, #3d9f3d 100%); box-shadow: inset 2px 2px 4px rgba(0,0,0,.4) }
#taskbar .task {
	flex: 0 0 162px; display: flex; align-items: center; text-align: left; padding: 3px 8px; cursor: pointer;
	overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
	font: 11px Tahoma, Arial, sans-serif; color: #fff;
	background: linear-gradient(180deg, #4993f1 0%, #3c83e3 50%, #2f74d6 100%);
	border: 0; border-radius: 3px; box-shadow: inset 1px 1px 0 rgba(255,255,255,.25);
}
/* Pressed in marks the focused window, as it did on the real thing. */
#taskbar .task.on { background: linear-gradient(180deg, #1e50b0 0%, #2a62c8 60%, #3f7ddd 100%); box-shadow: inset 1px 1px 3px rgba(0,0,0,.45) }
#taskbar .spacer { flex: 1 }
#clock, #stat, #count {
	padding: 3px 9px; color: #fff; font: 11px Tahoma, Arial, sans-serif;
}
#clock { background: linear-gradient(180deg, #1c8ad6 0%, #14a5e0 40%, #1291d8 100%); border-left: 1px solid #1a5fc8 }

/* Sits above the taskbar, the way it opens off the Start button rather than under it. */
#startmenu { display: none; position: absolute; left: 2px; bottom: 30px; z-index: 200; background: #c0c0c0; padding: 2px; min-width: 210px }
#startmenu.open { display: flex }
#startmenu .rail {
	width: 24px; background: linear-gradient(180deg, #000080, #1084d0); color: #fff;
	writing-mode: vertical-rl; transform: rotate(180deg);
	font: italic bold 15px Arial, sans-serif; text-align: left; padding: 8px 3px; letter-spacing: .5px;
}
#startmenu ul { list-style: none; margin: 0; padding: 2px 0; flex: 1 }
#startmenu li { display: flex; align-items: center; gap: 9px; padding: 5px 22px 5px 8px; cursor: pointer }
#startmenu li:hover { background: #000080; color: #fff }
#startmenu li.sep { padding: 0; margin: 3px 2px; height: 2px; border-top: 1px solid #808080; border-bottom: 1px solid #fff; cursor: default }
#startmenu li.sep:hover { background: transparent }
#startmenu li .ico { width: 18px; text-align: center; font-size: 14px }

/* ---- Sign On: the first screen, and the click that lets the modem be heard ---- */
#signon { display: none; position: absolute; inset: 0; z-index: 260; align-items: center; justify-content: center }
#signon.open { display: flex }
/* Windows stay out of sight until sign-on completes. */
.signing .child:not(#signonwin):not(#introwin) { visibility: hidden }
#signonwin { width: 420px }
#signonbody { display: flex; background: #efeee2 }
#signonbody .side {
	width: 116px; flex: none; padding: 16px 8px 10px; text-align: center; color: #cfe3f5;
	display: flex; flex-direction: column; align-items: center;
	background: linear-gradient(180deg, #2a7fbd, #14527e);
}
#signonbody .side img { width: 62px; height: 62px }
#signonbody .side .name { margin-top: 6px; font: italic bold 15px Georgia, serif; color: #fff }
#signonbody .side .ver { margin-top: auto; font-size: 10px; opacity: .85 }
#signonbody .fields { flex: 1; padding: 16px 16px 12px }
#signonbody label { display: block; font-weight: bold; margin: 0 0 3px }
#signonbody select, #signonbody input { width: 100%; margin-bottom: 12px }
#signonbody .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px }
#signonbody .row button { min-width: 84px }

/* ---- The sign-on dialog ---- */
#intro { display: none; position: absolute; inset: 0; z-index: 250; align-items: center; justify-content: center }
#intro.open { display: flex }
#introwin { width: min(660px, 86%); background: #f2f0e6 }
#introbody { padding: 16px 20px 14px; background: #f2f0e6 }
#intrologo { text-align: center; font: italic bold 34px Verdana, Arial, sans-serif; letter-spacing: -1px; margin-bottom: 16px }
#intrologo i { font-style: normal; font-size: 30px; vertical-align: -2px; margin-right: 6px }
#intrologo span { color: #17265c }
#intrologo b { color: #fdc005; text-shadow: 0 1px 0 #b98d00 }
#steps { display: flex; gap: 14px }
.step { flex: 1; text-align: center }
/* Empty lavender until the step is reached; the artwork lands as it becomes active. */
.step .box {
	height: 96px; background: #b8b7f4 no-repeat center / contain;
	border: 3px solid; border-color: #6a7ab8 #aab4dc #aab4dc #6a7ab8;
}
.step .cap { display: block; margin-top: 7px; color: #555 }
.step.on .cap { color: #000; font-weight: bold }
.step.on .box { box-shadow: 0 0 0 2px #17265c }
#introfoot { border-top: 2px solid #17265c; margin-top: 14px; padding-top: 12px; text-align: center }


/* "It's now safe…" — the one screen everyone who used a 98 box remembers. */
#shutdown { display: none; position: absolute; inset: 0; z-index: 400; background: #000; color: #ffa726;
	align-items: center; justify-content: center; text-align: center; cursor: pointer;
	font: bold 22px "MS Sans Serif", Tahoma, sans-serif; letter-spacing: .3px; line-height: 1.7 }
#shutdown.open { display: flex }
#shutdown small { display: block; font-size: 12px; font-weight: normal; color: #8a6a2a; margin-top: 14px }
`

const SCRIPT = `
var base = location.pathname.replace(/\\/+$/, "")
var FAVICON_URL = document.querySelector("link[rel=icon]").href
var api = base + "/api"
var messages = []
var current = null
var tab = "html"
var seen = 0
var read = {}

function $(id) { return document.getElementById(id) }
function esc(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function who(list) {
	if (!list || !list.length) return ""
	return list.map(function (a) { return a.name ? a.name + " <" + a.address + ">" : a.address }).join(", ")
}
/* AOL's own M/D/YY, because half the charm is the date column looking wrong. */
function when(ms) {
	var d = new Date(ms)
	return (d.getMonth() + 1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(2)
}
function clock() {
	var d = new Date()
	var h = d.getHours()
	var m = d.getMinutes()
	var ampm = h >= 12 ? "PM" : "AM"
	h = h % 12
	if (!h) h = 12
	$("clock").textContent = h + ":" + (m < 10 ? "0" : "") + m + " " + ampm
}

function render_list() {
	var tbody = $("rows")
	tbody.innerHTML = ""
	$("empty").style.display = messages.length ? "none" : "block"
	messages.forEach(function (m) {
		var tr = document.createElement("tr")
		tr.className = (read[m.id] ? "" : "unread") + (current && current.id === m.id ? " on" : "")
		tr.innerHTML =
			'<td class="flag">' + (read[m.id] ? "\\u{1F4E7}" : "\\u2709") + "</td>" +
			'<td class="when">' + when(m.received_at) + "</td>" +
			'<td class="who">' + esc(who(m.to)) + "</td>" +
			"<td>" + esc(m.subject || "(no subject)") + "</td>"
		tr.onclick = function () { open_message(m) }
		tbody.appendChild(tr)
	})
	var unread = messages.filter(function (m) { return !read[m.id] }).length
	$("count").textContent =
		messages.length + " message" + (messages.length === 1 ? "" : "s") + (unread ? ", " + unread + " new" : "")
	$("gotmail").className = unread ? "on" : ""
	$("address").textContent = unread
		? "Postboi: You Have Mail! (" + unread + " new)"
		: "Postboi: Welcome back!"
	document.title = (unread ? "(" + unread + ") " : "") + "Postboi Mail"
	$("stat").textContent = messages.length ? "Ready" : "Waiting for mail\\u2026"
	$("keepnew").disabled = !current
}

function open_message(m) {
	current = m
	read[m.id] = true
	render_list()
	render_reader()
}

function row(label, value) {
	return value ? "<dt>" + label + ":</dt><dd>" + esc(value) + "</dd>" : ""
}

function render_reader() {
	var reader = $("reader")
	var win = find("reader")
	if (!current) {
		reader.className = "child window"
		if (win) {
			win.open = false
			if (focused === "reader") focused = "mailbox"
			paint()
		}
		return
	}
	reader.className = "child window open" + (win && win.min ? " min" : "")
	if (win) {
		win.title = current.subject || "(no subject)"
		var reopened = !win.open
		win.open = true
		if (reopened) focus_window("reader")
		else paint()
	}
	$("reader-title").textContent = current.subject || "(no subject)"
	var index = messages.indexOf(current)
	$("r-count").textContent = index < 0 ? "" : index + 1 + " of " + messages.length
	$("r-prev").disabled = index <= 0
	$("r-next").disabled = index < 0 || index >= messages.length - 1
	$("head").innerHTML =
		'<div class="subject">' + esc(current.subject || "(no subject)") + "</div><dl>" +
		row("From", who([current.from])) +
		row("To", who(current.to)) +
		row("Cc", who(current.cc)) +
		row("Bcc", who(current.bcc)) +
		row("Reply-To", who(current.reply_to)) +
		row("Sent", new Date(current.received_at).toLocaleString()) +
		"</dl>"

	var tabs = $("tabs")
	Array.prototype.forEach.call(tabs.children, function (b) {
		b.className = b.dataset.tab === tab ? "on" : ""
	})

	var pane = $("pane")
	if (tab === "html") {
		if (!current.html && !current.text) {
			pane.innerHTML = '<div id="blank">This message has no body.</div>'
		} else {
			// sandbox with nothing allowed: the mail renders, its scripts don't run, and it
			// can't reach the dev server it happens to be served from.
			pane.innerHTML = '<iframe sandbox="" src="' + api + "/messages/" + current.id + '/body"></iframe>'
		}
	} else if (tab === "text") {
		pane.innerHTML = "<pre>" + esc(current.text || "(no plain-text part)") + "</pre>"
	} else if (tab === "source") {
		pane.innerHTML = "<pre>" + esc(current.html || current.text || "") + "</pre>"
	} else {
		var files = current.attachments || []
		if (!files.length) {
			pane.innerHTML = '<div id="blank">No attachments.</div>'
		} else {
			pane.innerHTML = '<div class="files">' + files.map(function (f, i) {
				var size = Math.round((f.content.length * 3) / 4 / 102.4) / 10
				return '<a download="' + esc(f.name) + '" href="' + api + "/messages/" + current.id + "/attachments/" + i +
					'">\\u{1F4CE} ' + esc(f.name) + " <span>(" + esc(f.mime_type) + ", " + size + " KB)</span></a>"
			}).join("") + "</div>"
		}
	}
}

function load() {
	return fetch(api + "/messages").then(function (r) { return r.json() }).then(function (data) {
		messages = data.messages || []
		if (current) current = messages.filter(function (m) { return m.id === current.id })[0] || null
		if (messages.length > seen && seen > 0) play("mail")
		seen = messages.length
		render_list()
		render_reader()
	})
}

/*
 * The voice. Muted state is remembered, and defaults to whatever the server was configured
 * with — a shared machine or a pairing session is exactly where an unexpected "Welcome!"
 * is least welcome.
 */
var muted = localStorage.getItem("postboi:sound")
	? localStorage.getItem("postboi:sound") === "off"
	: document.documentElement.dataset.sounds === "off"

/*
 * Browsers refuse audio until the page has been interacted with, and a freshly-opened
 * inbox has had none — so the greeting would simply never be heard. A blocked clip is
 * held and released by the first click or keypress instead of being dropped.
 */
var pending = null
function play(name) {
	if (muted) return null
	var audio = new Audio(api + "/sounds/" + name)
	audio.volume = 0.7
	var played = audio.play()
	if (played && played.catch) {
		played.catch(function () {
			pending = audio
		})
	}
	return audio
}

function release_pending() {
	if (!pending || muted) return
	var audio = pending
	pending = null
	audio.play().catch(function () {})
}
document.addEventListener("pointerdown", release_pending, true)
document.addEventListener("keydown", release_pending, true)

/** The handshake, held open for as long as the sign-on takes. */
var dialing = null
function stop_dialing() {
	if (!dialing) return
	dialing.pause()
	dialing = null
}

function apply_mute(on) {
	muted = on
	if (on) stop_dialing()
	var button = $("t-sound")
	button.className = on ? "tb" : "tb on"
	button.firstChild.textContent = on ? "\\u{1F507}" : "\\u{1F50A}"
	button.lastChild.nodeValue = on ? "Muted" : "Sound"
}


/* ---- Window manager ---- */
var wins = []
var z = 20
var focused = null

function ws_rect() {
	var w = $("workspace")
	return { w: w.clientWidth, h: w.clientHeight }
}

function place(el, r) {
	el.style.left = r.x + "px"
	el.style.top = r.y + "px"
	el.style.width = r.w + "px"
	el.style.height = r.h + "px"
}

function register(id, title, rect) {
	var el = $(id)
	var win = { id: id, el: el, title: title, restore: null, min: false, open: id === "mailbox" }
	wins.push(win)
	place(el, rect)

	el.addEventListener("mousedown", function () { focus_window(id) })
	var bar = el.querySelector(".title-bar")
	bar.addEventListener("mousedown", function (event) {
		if (event.target.dataset && event.target.dataset.act) return
		drag(win, event)
	})
	bar.addEventListener("dblclick", function (event) {
		if (event.target.dataset && event.target.dataset.act) return
		toggle_max(win)
	})
	bar.addEventListener("click", function (event) {
		var act = event.target.dataset && event.target.dataset.act
		if (act === "max") toggle_max(win)
		if (act === "min") { win.min = true; el.classList.add("min"); paint() }
		if (act === "close") close_window(win)
	})
	el.querySelector(".grip").addEventListener("mousedown", function (e) { resize(win, e, true, true) })
	el.querySelector(".edge-r").addEventListener("mousedown", function (e) { resize(win, e, true, false) })
	el.querySelector(".edge-b").addEventListener("mousedown", function (e) { resize(win, e, false, true) })
	return win
}

function find(id) {
	return wins.filter(function (w) { return w.id === id })[0]
}

function focus_window(id) {
	var win = find(id)
	if (!win || !win.open) return
	win.min = false
	win.el.classList.remove("min")
	win.el.style.zIndex = ++z
	focused = id
	paint()
}

function toggle_max(win) {
	var box = ws_rect()
	if (win.restore) {
		place(win.el, win.restore)
		win.restore = null
		win.el.classList.remove("max")
	} else {
		win.restore = {
			x: win.el.offsetLeft,
			y: win.el.offsetTop,
			w: win.el.offsetWidth,
			h: win.el.offsetHeight,
		}
		place(win.el, { x: 0, y: 0, w: box.w, h: box.h })
		win.el.classList.add("max")
	}
	focus_window(win.id)
}

function close_window(win) {
	win.open = false
	// The reader's visibility is driven by whether a message is selected, so closing it is
	// really deselecting; the mailbox just goes away and is reopened from the Start menu.
	if (win.id === "reader") {
		current = null
		render_list()
		render_reader()
		return
	}
	win.el.classList.add("closed")
	if (focused === win.id) focused = null
	paint()
}

/** Bring a closed or minimised window back — how the mailbox returns once it's shut. */
function open_window(id) {
	var win = find(id)
	if (!win) return
	win.open = true
	win.min = false
	win.el.classList.remove("closed", "min")
	focus_window(id)
}

/** Repaint what depends on window state: title-bar focus and the taskbar buttons. */
function paint() {
	var tasks = $("tasks")
	tasks.innerHTML = ""
	wins.forEach(function (win) {
		win.el.querySelector(".title-bar").className =
			"title-bar" + (focused === win.id && !win.min ? "" : " dim")
		if (!win.open) return
		var button = document.createElement("button")
		button.className = "task" + (focused === win.id && !win.min ? " on" : "")
		button.innerHTML = '<img class="mark" src="' + FAVICON_URL + '" alt="">'
		button.appendChild(document.createTextNode(win.title))
		button.onclick = function () {
			// Clicking the focused window's button minimises it, as the real taskbar did.
			if (focused === win.id && !win.min) {
				win.min = true
				win.el.classList.add("min")
				focused = null
				paint()
			} else focus_window(win.id)
		}
		tasks.appendChild(button)
	})
}

/** Shared pointer loop for both dragging and resizing — same maths, different target. */
function track(on_move) {
	document.body.classList.add("dragging")
	function move(event) { on_move(event) }
	function up() {
		document.body.classList.remove("dragging")
		document.removeEventListener("mousemove", move)
		document.removeEventListener("mouseup", up)
	}
	document.addEventListener("mousemove", move)
	document.addEventListener("mouseup", up)
}

function drag(win, event) {
	if (win.restore) return
	event.preventDefault()
	focus_window(win.id)
	var dx = event.clientX - win.el.offsetLeft
	var dy = event.clientY - win.el.offsetTop
	var box = ws_rect()
	track(function (e) {
		// Clamped so a window can never be dragged somewhere its title bar can't be grabbed back.
		var x = Math.max(-win.el.offsetWidth + 90, Math.min(box.w - 60, e.clientX - dx))
		var y = Math.max(0, Math.min(box.h - 24, e.clientY - dy))
		win.el.style.left = x + "px"
		win.el.style.top = y + "px"
	})
}

/**
 * Dragging for a dialog that isn't in the window list — the sign-on, which has no taskbar
 * button and nothing to raise above, but should still be shovable out of the way.
 */
function drag_dialog(el) {
	var bar = el.querySelector(".title-bar")
	if (bar.dataset.draggable) return
	bar.dataset.draggable = "1"
	bar.style.cursor = "default"
	bar.addEventListener("mousedown", function (event) {
		if (event.target.dataset && event.target.dataset.act) return
		event.preventDefault()
		var rect = el.getBoundingClientRect()
		// It's centred by flex until it's touched; pin it before the first move so it doesn't
		// jump out from under the cursor.
		el.style.position = "absolute"
		el.style.margin = "0"
		var host = el.parentNode.getBoundingClientRect()
		var dx = event.clientX - rect.left
		var dy = event.clientY - rect.top
		el.style.left = rect.left - host.left + "px"
		el.style.top = rect.top - host.top + "px"
		track(function (e) {
			el.style.left = e.clientX - dx - host.left + "px"
			el.style.top = e.clientY - dy - host.top + "px"
		})
	})
}

function resize(win, event, horizontal, vertical) {
	if (win.restore) return
	event.preventDefault()
	event.stopPropagation()
	focus_window(win.id)
	var x0 = event.clientX
	var y0 = event.clientY
	var w0 = win.el.offsetWidth
	var h0 = win.el.offsetHeight
	track(function (e) {
		if (horizontal) win.el.style.width = Math.max(320, w0 + e.clientX - x0) + "px"
		if (vertical) win.el.style.height = Math.max(140, h0 + e.clientY - y0) + "px"
	})
}

/* ---- Toolbar and action wiring ---- */
$("tabs").onclick = function (event) {
	if (!event.target.dataset || !event.target.dataset.tab) return
	tab = event.target.dataset.tab
	render_reader()
}
$("r-prev").onclick = function () {
	var i = messages.indexOf(current)
	if (i > 0) open_message(messages[i - 1])
}
$("r-next").onclick = function () {
	var i = messages.indexOf(current)
	if (i >= 0 && i < messages.length - 1) open_message(messages[i + 1])
}
$("t-read").onclick = function () { if (messages.length) open_message(current || messages[0]) }
$("t-refresh").onclick = function () { load() }
$("t-print").onclick = function () { window.print() }
$("a-read").onclick = function () { if (messages.length) open_message(current || messages[0]) }
$("keepnew").onclick = function () {
	if (!current) return
	delete read[current.id]
	current = null
	render_list()
	render_reader()
}
function wipe() {
	if (!confirm("Delete every message in the inbox?")) return
	fetch(api + "/messages", { method: "DELETE" }).then(function () {
		current = null
		seen = 0
		read = {}
		load()
	})
}
$("t-delete").onclick = wipe
$("a-delete").onclick = wipe


/* ---- Start menu, opened by the Windows key (Cmd on macOS — both report "Meta") ---- */
var menu = $("startmenu")
function set_menu(open) {
	menu.className = open ? "open" : ""
	$("start").className = open ? "on" : ""
}
$("start").onclick = function (event) {
	event.stopPropagation()
	set_menu(menu.className !== "open")
}
document.addEventListener("click", function () { set_menu(false) })
menu.addEventListener("click", function (event) { event.stopPropagation() })

/*
 * Only a *bare* Meta press counts. Holding it as a modifier is how you copy, reload and
 * switch tabs, so anything with another key in between is left well alone.
 */
var meta_alone = false
document.addEventListener("keydown", function (event) {
	if (event.key === "Meta") meta_alone = true
	else meta_alone = false
	if (event.key === "Escape") { set_menu(false); $("shutdown").className = "" }
})
document.addEventListener("keyup", function (event) {
	if (event.key === "Meta" && meta_alone) set_menu(menu.className !== "open")
	meta_alone = false
})

$("m-mailbox").onclick = function () { open_window("mailbox"); set_menu(false) }
$("m-refresh").onclick = function () { open_window("mailbox"); load(); set_menu(false) }
$("m-docs").onclick = function () { window.open("https://docs.postboi.email/dev-inbox", "_blank"); set_menu(false) }
$("m-shutdown").onclick = function () {
	set_menu(false)
	play("goodbye")
	$("shutdown").className = "open"
}

apply_mute(muted)
$("t-sound").onclick = function () {
	localStorage.setItem("postboi:sound", muted ? "on" : "off")
	apply_mute(!muted)
	if (!muted) play("welcome")
}
$("shutdown").onclick = function () { $("shutdown").className = "" }

/*
 * The sign-on. Purely theatre over an inbox that's already live behind it — the fetch and
 * the event stream start immediately, so cancelling never costs you anything.
 */
var STEP_ART = ["locating", "connecting", "intercepting"]
var intro_timers = []
function end_intro() {
	intro_timers.forEach(clearTimeout)
	intro_timers = []
	// The handshake belongs to the dialog: it stops the moment the mailbox is up, and the
	// greeting lands on the main screen rather than over the top of it.
	stop_dialing()
	pending = null
	$("intro").className = ""
	// Revealed here rather than by wrapping this function: Cancel and the close box both
	// captured a reference to it before any wrapper could be installed.
	$("workspace").classList.remove("signing")
	play("welcome")
}
function run_intro() {
	for (var i = 0; i < 3; i++) {
		$("s" + i).className = "step"
		$("s" + i).querySelector(".box").style.backgroundImage = ""
	}
	$("intro").className = "open"
	drag_dialog($("introwin"))
	dialing = play("dialup")
	var step = 300
	for (var i = 0; i < 3; i++) {
		;(function (n) {
			intro_timers.push(setTimeout(function () {
				if (n > 0) $("s" + (n - 1)).className = "step done"
				$("s" + n).className = "step on"
				// The panel arrives with the step, which is what makes the boxes fill in one
				// at a time rather than all being there from the start.
				$("s" + n).querySelector(".box").style.backgroundImage =
					"url(" + api + "/art/" + STEP_ART[n] + ")"
			}, step + n * 820))
		})(i)
	}
	intro_timers.push(setTimeout(function () {
		$("s2").className = "step done"
	}, step + 3 * 820))
	intro_timers.push(setTimeout(end_intro, step + 3 * 820 + 380))
}
$("intro-cancel").onclick = end_intro
$("introwin").querySelector('[data-act="close"]').onclick = end_intro

/*
 * Opening layout. The mailbox takes the top third and the reader the rest — mail is the
 * thing you came to read, so it gets the room by default, and both can be moved, resized
 * or maximised from there.
 */
var box = ws_rect()
/* Centred, the way the screenshots have it: the mailbox floating mid-desktop and mail
   opening in front of it, rather than the two tiled edge to edge. */
var mb = { w: Math.min(760, box.w - 40), h: Math.min(430, box.h - 40) }
var mbx = Math.round((box.w - mb.w) / 2)
var mby = Math.max(0, Math.round((box.h - mb.h) / 2) - 20)
register("mailbox", "Your Local Mailbox", { x: mbx, y: mby, w: mb.w, h: mb.h })
/* Centred both ways, in front of the mailbox. */
var rd = { w: Math.min(700, box.w - 60), h: Math.min(430, box.h - 60) }
register("reader", "Message", {
	x: Math.round((box.w - rd.w) / 2),
	y: Math.max(0, Math.round((box.h - rd.h) / 2)),
	w: rd.w,
	h: rd.h,
})
focus_window("mailbox")

clock()
setInterval(clock, 10000)
new EventSource(api + "/events").onmessage = function () { load() }
load()
/*
 * Sign On first. It's the era-correct front door, and it doubles as the fix for a real
 * problem: browsers refuse audio until the page has been interacted with, so nothing was
 * ever going to be heard on a cold load. Pressing SIGN ON is that interaction, which is
 * why the handshake under the connecting dialog actually plays.
 */
if (document.documentElement.dataset.intro === "on") {
	$("signon").className = "open"
	$("workspace").classList.add("signing")
	drag_dialog($("signonwin"))
} else {
	play("welcome")
}
$("so-go").onclick = function () {
	$("signon").className = ""
	run_intro()
}

$("so-help").onclick = function () {
	window.open("https://docs.postboi.email/dev-inbox", "_blank")
}
`

/** How the page starts out. Both are still toggleable in the UI, and the choice sticks. */
export interface InboxUiOptions {
	/** Start with sounds on. Defaults to true. */
	sounds?: boolean
	/**
	 * Play the "Connecting To Postboi…" sign-on before showing the inbox. Defaults to true.
	 * Theatre only — the inbox loads behind it, so turning it off costs nothing but the joke.
	 */
	intro?: boolean
}

/** The inbox document. Built per request — it's a dev server, and a string is cheap. */
export function inbox_ui({ sounds = true, intro = true }: InboxUiOptions = {}): string {
	return `<!doctype html>
<html lang="en" data-sounds="${sounds ? "on" : "off"}" data-intro="${intro ? "on" : "off"}"
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Postboi Mail</title>
<link rel="icon" href="${FAVICON}">
<style>${THEME_CSS}</style>
<style>${CSS}</style>
</head>
<body>
<div id="screen">

	<div id="aol" class="window">
		<div class="title-bar">
			<div class="title-bar-text"><img class="mark" src="${FAVICON}" alt=""> Postboi Local</div>
			<div class="title-bar-controls">
				<button aria-label="Minimize"></button>
				<button aria-label="Maximize"></button>
				<button aria-label="Close"></button>
			</div>
		</div>
		<div id="menubar">
			<span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>W</u>indow</span><span><u>S</u>ign Off</span><span><u>H</u>elp</span>
		</div>

		<div id="toolbar">
			<div class="band b1">
				<button class="tb" id="t-read"><span class="ico">&#128229;</span>Read</button>
				<button class="tb" id="t-refresh"><span class="ico">&#128260;</span>Mail Center</button>
				<button class="tb" id="t-print"><span class="ico">&#128424;</span>Print</button>
				<button class="tb" id="t-delete"><span class="ico">&#128465;</span>Delete All</button>
			</div>
			<div class="band b2">
				<button class="tb" id="t-sound"><span class="ico">&#128266;</span>Sound</button>
			</div>
			<!-- Set dressing: the bar looked wrong without them, and they do nothing on purpose. -->
			<div class="band b3">
				<span class="tb inert"><span class="ico">&#127760;</span>Internet</span>
				<span class="tb inert"><span class="ico">&#128225;</span>Channels</span>
			</div>
			<div class="band b4">
				<span class="tb inert"><span class="ico">&#128101;</span>People</span>
			</div>
			<div class="band b5"><span style="color:#fff;font:italic bold 15px Arial,sans-serif">postboi.</span></div>
		</div>

		<div id="nav">
			<button class="rnd">&#9664;</button><button class="rnd">&#9654;</button>
			<button class="rnd">&#10006;</button><button class="rnd">&#8635;</button>
			<button class="rnd">&#8962;</button>
			<span class="pill">Find &#9662;</span>
			<span id="address" class="thin-sunken">Postboi: Welcome back!</span>
			<span class="pill">Go</span><span class="pill">Keyword</span>
		</div>

		<div id="workspace">
			<div id="mailbox" class="child window">
				<div class="title-bar">
					<div class="title-bar-text"><img class="mark" src="${FAVICON}" alt=""> Your Local Mailbox</div>
					<div class="title-bar-controls">
						<button aria-label="Minimize" data-act="min"></button>
						<button aria-label="Maximize" data-act="max"></button>
						<button aria-label="Close" data-act="close"></button>
					</div>
				</div>

				<div id="mbhead">
					<div class="mark">
						<svg width="42" height="34" viewBox="0 0 46 34" aria-hidden="true">
							<g class="flag">
								<path d="M27 30V4h3v26z" fill="#3a3a3a"/>
								<path d="M30 4h14l-4 4.5 4 4.5H30z" fill="#fdc005" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
							</g>
							<path d="M3 16a11 11 0 0 1 22 0v13H3z" fill="#e8e8e8" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
							<path d="M14 5v24" stroke="#000" stroke-width="2"/>
							<path d="M14 16a5.5 5.5 0 0 1 11 0v13H14z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
						</svg>
						<span>Mailbox</span>
					</div>
					<div class="reminder">
						<div id="gotmail"><span class="shout">You've Got <b>Mail!</b></span></div>
						REMINDER: Postboi will never send this mail anywhere.<br>
						Everything here was captured locally instead of going out.
					</div>
				</div>

				<div id="folders">
					<button class="on">New Mail</button>
					<button>Old Mail</button>
					<button>Sent Mail</button>
				</div>
				<div id="listwrap">
					<div id="list" class="thin-sunken">
						<table><tbody id="rows"></tbody></table>
						<div id="empty">Your online mailbox is empty.<br>Send something from your app and it will arrive here.</div>
					</div>
				</div>

				<div id="actions">
					<button class="aolbtn" id="a-read">Read</button>
					<button class="aolbtn" id="keepnew" disabled>Keep As New</button>
					<span class="spacer"></span>
					<button class="aolbtn" id="a-delete">Delete All</button>
				</div>
				<span class="edge edge-r"></span><span class="edge edge-b"></span><span class="grip"></span>
			</div>


			<div id="signon">
			<div id="signonwin" class="child window">
			<div class="title-bar">
			<div class="title-bar-text"><img class="mark" src="${FAVICON}" alt=""> Sign On</div>
			</div>
			<div id="signonbody">
			<div class="side">
			<img src="${FAVICON}" alt="">
			<div class="name">postboi</div>
						<div class="ver">local edition</div>
			</div>
			<div class="fields">
			<label for="so-name">Select Screen Name:</label>
			<select id="so-name" disabled><option>Postboi</option></select>
			<label for="so-pass">Enter Password:</label>
			<input id="so-pass" type="password" value="secret" disabled>
			<label for="so-loc">Select Location:</label>
			<select id="so-loc" disabled><option>Local 33.6k Modem</option></select>
			<div class="row">
			<button id="so-help">HELP</button>
			<button id="so-go">SIGN ON</button>
			</div>
			</div>
			</div>
			</div>
			</div>

			<div id="intro">
			<div id="introwin" class="child window">
			<div class="title-bar">
			<div class="title-bar-text"><img class="mark" src="${FAVICON}" alt=""> Connecting To Postboi&#8230;</div>
			<div class="title-bar-controls"><button aria-label="Close" data-act="close"></button></div>
			</div>
			<div id="introbody">
			<div id="intrologo"><img src="${FAVICON}" alt=""><span>post</span><b>boi</b></div>
			<div id="steps">
			<div class="step" id="s0"><div class="box"></div><span class="cap">1. Locating mailroom&#8230;</span></div>
			<div class="step" id="s1"><div class="box"></div><span class="cap">2. Connecting to localhost&#8230;</span></div>
			<div class="step" id="s2"><div class="box"></div><span class="cap">3. Intercepting outgoing mail&#8230;</span></div>
			</div>
			<div id="introfoot"><button class="aolbtn" id="intro-cancel">Cancel</button></div>
			</div>
			</div>
			</div>
			<div id="reader" class="child window">
				<div class="title-bar">
					<div class="title-bar-text"><span>&#9993;</span> <span id="reader-title"></span></div>
					<div class="title-bar-controls">
						<button aria-label="Minimize" data-act="min"></button>
						<button aria-label="Maximize" data-act="max"></button>
						<button aria-label="Close" data-act="close" id="reader-close"></button>
					</div>
				</div>
				<div id="head"></div>
				<div id="tabs">
					<button data-tab="html" class="on">Message</button>
					<button data-tab="text">Plain Text</button>
					<button data-tab="source">Source</button>
					<button data-tab="files">Attachments</button>
				</div>
				<div id="pane" class="thin-sunken"></div>
				<div id="readerfoot">
					<button class="aolbtn" id="r-prev">&#9664; Prev</button>
					<span id="r-count"></span>
					<button class="aolbtn" id="r-next">Next &#9654;</button>
				</div>
				<span class="edge edge-r"></span><span class="edge edge-b"></span><span class="grip"></span>
			</div>
		</div>
	</div>

	<div id="taskbar">
		<button id="start"><svg class="flag" width="21" height="18" viewBox="0 0 21 18" aria-hidden="true"><path d="M0.5 3.7 8.8 2.1 8.8 8.5 0.5 8.8Z" fill="#f65314"/><path d="M9.9 1.9 20.4 0 20.4 8.4 9.9 8.5Z" fill="#7cbb00"/><path d="M0.5 9.6 8.8 9.8 8.8 16.1 0.5 14.6Z" fill="#00a1f1"/><path d="M9.9 9.8 20.4 10 20.4 18 9.9 16.3Z" fill="#ffbb00"/></svg><span>start</span></button>
		<span id="tasks" style="display:flex;gap:4px"></span>
		<span class="spacer"></span>
		<!-- The count lives out here rather than in the mailbox header, which is the first
		     thing hidden when a message is open. -->
		<span id="count" style="padding:3px 9px"></span>
		<span id="stat" style="padding:3px 9px">Waiting for mail&#8230;</span>
		<span id="clock"></span>
	</div>

	<div id="startmenu">
		<div class="rail">Postboi&nbsp;XP</div>
		<ul>
			<li id="m-mailbox"><span class="ico">&#128236;</span>Your Local Mailbox</li>
			<li id="m-refresh"><span class="ico">&#128260;</span>Check Mail Now</li>
			<li id="m-docs"><span class="ico">&#128218;</span>Help&#8230;</li>
			<li class="sep"></li>
			<li id="m-shutdown"><span class="ico">&#9211;</span>Shut Down&#8230;</li>
		</ul>
	</div>



	<div id="shutdown">
		<div>
			It&#8217;s now safe to turn off<br>your computer.
			<small>(Your mail is still in the inbox. Click anywhere.)</small>
		</div>
	</div>

</div>
<script>${SCRIPT}</script>
</body>
</html>`
}
