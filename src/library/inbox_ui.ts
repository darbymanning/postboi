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

const CSS = `
/* Phosphor primaries, from the reference pen. */
:root { --crt-red: rgb(218, 49, 49); --crt-green: rgb(112, 159, 115); --crt-blue: rgb(40, 129, 206) }
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
/* Its .window padding is for dialogs; these are frames holding a full-bleed layout. */
.window { padding: 3px; display: flex; flex-direction: column; min-height: 0 }
.title-bar { flex: none }
.title-bar.dim { background: linear-gradient(90deg, #7f7f7f, #b5b5b5) }

/*
 * The CRT. Decoration over a normal DOM — no canvas, no shader, because the message
 * preview is an iframe and an iframe can't go through a fragment shader. All of it hangs
 * off .crt on <html>, so the toolbar toggle is one class away.
 */
#bezel {
	height: 100vh; padding: 18px;
	background: radial-gradient(120% 90% at 50% 0%, #23262a, #101113 60%, #0a0b0c);
}
.crt #bezel { padding: 40px; background: radial-gradient(120% 90% at 50% 0%, #2a2d31, #141517 55%, #0a0b0c), #0a0b0c }
#screen { position: relative; height: 100%; overflow: hidden; background: #3a6ea5 }
/* Everything the user actually looks at. Separated from the overlays so the barrel bends
   the UI without also bending the phosphor mask — displacing a 3px RGB stripe by a
   smoothly varying offset moirés into a checkerboard, and the mask is on the glass in
   front of the picture anyway, not part of it. */
#warp { position: relative; height: 100%; display: flex; flex-direction: column }
/* Curvature is faked: a rounded, inset-lit tube plus the corner falloff below. Real barrel
   distortion would need a shader, and would bend the mail you're trying to read. */
/*
 * The tube's actual shape. An SVG clip path in objectBoundingBox units, so the edges bow
 * outward and scale with the window — this is the one part of the curve that's real
 * geometry rather than shading. The content inside stays flat: bending live DOM needs a
 * displacement map, and it would bend the mail you're trying to read.
 *
 * drop-shadow rather than box-shadow, because a filter follows the clipped silhouette
 * while a box-shadow would be clipped away with everything else outside the path.
 */
.crt #screen {
	clip-path: url(#tube);
	/* The corners are the deepest part of the clip, and the warp pulls content further in
	   still, so the UI is inset past both — otherwise the curve eats the title bar. */
	padding: 44px 30px;
	filter:
		drop-shadow(0 0 2px #000)
		drop-shadow(0 0 26px rgba(70,150,220,.34))
		drop-shadow(0 20px 60px rgba(0,0,0,.9));
}
/* Bloom, plus the pen's glow-and-fringe text-shadow. Applied to light text on dark only:
   on the black-on-grey of the Windows chrome, a currentColor glow is a black smudge. */
.crt #warp { filter: url(#barrel) contrast(1.1) saturate(1.18) brightness(1.05) }
.crt .title-bar, .crt #folders button, .crt #tabs button, .crt .band.b5 span, .crt #shutdown {
	text-shadow: 0 0 .2em currentColor, 1px 1px rgba(255,0,255,.5), -1px -1px rgba(0,255,255,.4);
}
/* The active folder/reader tab flips to dark-on-white, where that glow would smudge. */
.crt #folders button.on, .crt #tabs button.on { text-shadow: none }

/*
 * The phosphor mask. Two coloured RGB gradients blended with "overlay" rather than black
 * scanlines — that's the whole difference between "a tube" and "a dusty screenshot": these
 * modulate the hue of what's underneath instead of just darkening it.
 */
/*
 * Siblings of the app, not children of a wrapper: an absolutely-positioned parent with a
 * z-index is its own stacking context, and a blended child then blends against *that* —
 * i.e. against nothing — and paints as flat opaque bands over the whole UI.
 */
#mask-h, #mask-v, #vig { display: none }
.crt #mask-h, .crt #mask-v {
	display: block; position: absolute; inset: 0; pointer-events: none;
	mix-blend-mode: overlay;
	/* Full strength is built for white-on-black; this sits over a light grey desktop, where
	   it swamps the picture. Held back to roughly a third. */
	opacity: .34;
	animation: flicker 6.5s steps(1) infinite;
}
/* Horizontal scanline phosphor, on a 4px cycle. */
.crt #mask-h { z-index: 300; background: repeating-linear-gradient(var(--crt-red) 0px, var(--crt-green) 2px, var(--crt-blue) 4px) }
/* Vertical aperture grille, finer at 3px. */
.crt #mask-v { z-index: 301; background: repeating-linear-gradient(90deg, var(--crt-red) 1px, var(--crt-green) 2px, var(--crt-blue) 3px) }

/* Vignette kept on its own layer, above the masks and unblended, so the corner falloff
   stays neutral instead of being tinted by the phosphor. */
.crt #vig {
	display: block; position: absolute; inset: 0; z-index: 303; pointer-events: none;
	background:
		/* Corner falloff does the work curvature can't: an ellipse tighter than the box, so
		   the four corners darken hardest — the shape a tube actually has. */
		radial-gradient(ellipse 78% 76% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.34) 80%, rgba(0,0,0,.85) 100%),
		linear-gradient(198deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.03) 20%, rgba(255,255,255,0) 38%);
}
/* Film grain — the tube's noise floor, and the thing that stops large flat areas reading
   as flat vector fill. */
#grain { display: none }
.crt #grain {
	display: block; position: absolute; inset: 0; z-index: 304; pointer-events: none;
	opacity: .32; mix-blend-mode: overlay;
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)'/%3E%3C/svg%3E");
	background-size: 260px 260px;
}
.crt #roll {
	position: absolute; left: 0; right: 0; height: 34%; z-index: 302; pointer-events: none;
	background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.035) 50%, rgba(255,255,255,0) 100%);
	animation: roll 7s linear infinite;
}
#roll { display: none }
@keyframes flicker { 0%, 97% { opacity: 1 } 98% { opacity: .86 } 99% { opacity: 1 } 100% { opacity: .93 } }
@keyframes roll { 0% { top: -34% } 100% { top: 100% } }
/* Motion is the part that makes people ill; the static texture is harmless, so keep it. */
@media (prefers-reduced-motion: reduce) {
	.crt #mask-h, .crt #mask-v { animation: none }
	.crt #roll { display: none }
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
#workspace { flex: 1; position: relative; background: #6a6a6a; min-height: 0; padding: 10px }
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
.child.min, #reader.open.min { display: none }
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

/* Mailbox header: wordmark, the security reminder, and the ad slot that was always there. */
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
#ad { width: 250px; border: 2px solid #000080; background: #d8d8e8 }
#ad .hd { background: #d02020; color: #fff; font-weight: bold; padding: 2px 5px }
#ad .bd { padding: 4px 6px; font-size: 11px; line-height: 1.4 }
#ad .meter { height: 7px; background: #fff; border: 1px solid #808080; margin: 3px 0; position: relative }
#ad .meter i { position: absolute; left: 46%; top: -2px; width: 7px; height: 11px; background: #00a000; border: 1px solid #004000 }

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
#taskbar { display: flex; align-items: center; gap: 4px; padding: 2px 3px; background: #c0c0c0; border-top: 1px solid #dfdfdf; margin: 0 2px 2px }
#start {
	display: flex; align-items: center; gap: 4px; padding: 2px 7px 3px 4px; font-weight: bold; cursor: pointer; background: #c0c0c0;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
#start.on { border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000 }
#taskbar .task {
	flex: 0 1 190px; text-align: left; padding: 3px 8px; background: #c0c0c0; cursor: pointer; font-weight: bold;
	overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
/* The pressed-in look marks the focused window, as it did on the real thing. */
#taskbar .task.on { border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000; background: #d4d0c8 }
#taskbar .spacer { flex: 1 }
#clock { padding: 3px 9px; border: 1px solid; border-color: #808080 #fff #fff #808080 }

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

/* ---- The sign-on dialog ---- */
#intro { display: none; position: absolute; inset: 0; z-index: 250; background: #6a6a6a; align-items: center; justify-content: center }
#intro.open { display: flex }
#introwin { width: min(660px, 86%); background: #f2f0e6 }
#introbody { padding: 16px 20px 14px; background: #f2f0e6 }
#intrologo { text-align: center; font: italic bold 34px Verdana, Arial, sans-serif; letter-spacing: -1px; margin-bottom: 16px }
#intrologo i { font-style: normal; font-size: 30px; vertical-align: -2px; margin-right: 6px }
#intrologo span { color: #17265c }
#intrologo b { color: #fdc005; text-shadow: 0 1px 0 #b98d00 }
#steps { display: flex; gap: 14px }
.step { flex: 1; text-align: center }
/* Empty on purpose — the boxes are where the animation would go if we had one. */
.step .box { height: 92px; background: #c9c9f0; border: 3px solid; border-color: #6a7ab8 #aab4dc #aab4dc #6a7ab8;
	display: flex; align-items: center; justify-content: center; font-size: 30px; color: #3b4a86 }
.step .cap { display: block; margin-top: 7px; color: #555 }
.step.on .cap { color: #000; font-weight: bold }
.step.on .box { background: #d8d8fa; box-shadow: 0 0 0 2px #17265c }
.step.done .box { background: #bcd8bc }
#introfoot { border-top: 2px solid #17265c; margin-top: 14px; padding-top: 12px; text-align: center }
/* Ellipsis that actually animates, so a paused step doesn't look like a hang. */
@keyframes dots { 0% { content: "." } 33% { content: ".." } 66% { content: "..." } }
.step.on .box::after { content: "."; animation: dots 900ms steps(1) infinite; font: bold 34px monospace; letter-spacing: 2px }

/* "It's now safe…" — the one screen everyone who used a 98 box remembers. */
#shutdown { display: none; position: absolute; inset: 0; z-index: 400; background: #000; color: #ffa726;
	align-items: center; justify-content: center; text-align: center; cursor: pointer;
	font: bold 22px "MS Sans Serif", Tahoma, sans-serif; letter-spacing: .3px; line-height: 1.7 }
#shutdown.open { display: flex }
#shutdown small { display: block; font-size: 12px; font-weight: normal; color: #8a6a2a; margin-top: 14px }
`

const SCRIPT = `
var base = location.pathname.replace(/\\/+$/, "")
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

function play(name) {
	if (muted) return null
	var audio = new Audio(api + "/sounds/" + name)
	audio.volume = 0.7
	// Browsers refuse audio until the page has been interacted with. That's a promise
	// rejection, not an error worth surfacing — the next one will play.
	var played = audio.play()
	if (played && played.catch) played.catch(function () {})
	return audio
}

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

/*
 * The barrel warp. feDisplacementMap resamples the rendered UI through an image whose red
 * and green channels carry the x and y offsets, so the chrome genuinely bends toward the
 * tube's edges instead of being sliced off by the clip — open the Start menu in the corner
 * and it curves with the glass.
 *
 * Deliberately gentle. Hit-testing is *not* displaced: the browser still tests clicks
 * against the undistorted layout, so every pixel of bend is a pixel of aiming error at the
 * edges. K is set where the curve reads but a Start-menu row still catches its own click.
 */
var WARP_K = 0.035

function build_warp() {
	var el = $("warp")
	var w = el.offsetWidth
	var h = el.offsetHeight
	if (!w || !h) return
	var size = 256
	var canvas = document.createElement("canvas")
	canvas.width = size
	canvas.height = size
	var ctx = canvas.getContext("2d")
	var image = ctx.createImageData(size, size)
	for (var j = 0; j < size; j++) {
		for (var i = 0; i < size; i++) {
			var u = (i / (size - 1)) * 2 - 1
			var v = (j / (size - 1)) * 2 - 1
			// Normalised so the corners land at ±1 rather than saturating and flattening out.
			var r2 = (u * u + v * v) / 2
			// Sample from nearer the centre the further out you are, so the picture bows. The
			// offsets are encoded across the *whole* 0–255 range and the strength lives in
			// the filter's scale instead: squeezed into a few levels either side of 128, an
			// 8-bit map bands the picture into visible steps.
			var dx = -u * r2
			// The vertical offset carries the aspect ratio, because one scale drives both axes.
			var dy = -v * r2 * (h / w)
			var p = (j * size + i) * 4
			image.data[p] = Math.max(0, Math.min(255, Math.round((dx * 0.5 + 0.5) * 255)))
			image.data[p + 1] = Math.max(0, Math.min(255, Math.round((dy * 0.5 + 0.5) * 255)))
			image.data[p + 2] = 0
			image.data[p + 3] = 255
		}
	}
	ctx.putImageData(image, 0, 0)
	var map = $("warpmap")
	map.setAttribute("href", canvas.toDataURL())
	// Explicit pixels, not percentages: anywhere the map fails to cover the filter region
	// reads as zero, and zero means "displace by half the scale" — which folds the whole UI
	// into a corner. The image has to blanket the region exactly.
	map.setAttribute("x", "0")
	map.setAttribute("y", "0")
	map.setAttribute("width", String(w))
	map.setAttribute("height", String(h))
	// displacement_px = scale * (channel - 0.5), and the encoding now spans the full range,
	// so the worst-case offset is K * w / 2 and one quantisation step is well under a pixel.
	$("warpdisp").setAttribute("scale", String(WARP_K * w))
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
	current = null
	render_list()
	render_reader()
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
		button.textContent = win.title
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

/*
 * The tube is on by default, but scanlines over a message you're checking the design of
 * are the opposite of useful — so it's one click off, and the choice sticks.
 */
function apply_crt(on) {
	document.documentElement.className = on ? "crt" : ""
	$("t-crt").className = on ? "tb on" : "tb"
}
apply_crt(localStorage.getItem("postboi:crt") !== "off")
$("t-crt").onclick = function () {
	var on = document.documentElement.className !== "crt"
	localStorage.setItem("postboi:crt", on ? "on" : "off")
	apply_crt(on)
}

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

$("m-crt").onclick = function () { $("t-crt").onclick(); set_menu(false) }
$("m-refresh").onclick = function () { load(); set_menu(false) }
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
var intro_timers = []
function end_intro() {
	intro_timers.forEach(clearTimeout)
	intro_timers = []
	// The handshake belongs to the dialog: it stops the moment the mailbox is up, and the
	// greeting lands on the main screen rather than over the top of it.
	stop_dialing()
	$("intro").className = ""
	play("welcome")
}
function run_intro() {
	$("intro").className = "open"
	drag_dialog($("introwin"))
	dialing = play("dialup")
	var step = 300
	for (var i = 0; i < 3; i++) {
		;(function (n) {
			intro_timers.push(setTimeout(function () {
				if (n > 0) $("s" + (n - 1)).className = "step done"
				$("s" + n).className = "step on"
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
/* Mail opens in front of the mailbox but starts below its list, so the message you picked
   stays in view behind — the way the reference shot has it. */
var ry = mby + 196
register("reader", "Message", {
	x: mbx + 8,
	y: ry,
	w: mb.w - 16,
	h: Math.max(240, Math.min(400, box.h - ry - 8)),
})
focus_window("mailbox")

build_warp()
window.addEventListener("resize", build_warp)

clock()
setInterval(clock, 10000)
new EventSource(api + "/events").onmessage = function () { load() }
load()
if (document.documentElement.dataset.intro === "on") run_intro()
else play("welcome")
`

/** How the page starts out. Both are still toggleable in the UI, and the choice sticks. */
export interface InboxUiOptions {
	/** Start with the CRT treatment on. Defaults to true. */
	crt?: boolean
	/** Start with sounds on. Defaults to true. */
	sounds?: boolean
	/**
	 * Play the "Connecting To Postboi…" sign-on before showing the inbox. Defaults to true.
	 * Theatre only — the inbox loads behind it, so turning it off costs nothing but the joke.
	 */
	intro?: boolean
}

/** The inbox document. Built per request — it's a dev server, and a string is cheap. */
export function inbox_ui({ crt = true, sounds = true, intro = true }: InboxUiOptions = {}): string {
	return `<!doctype html>
<html lang="en"${crt ? ' class="crt"' : ""} data-sounds="${sounds ? "on" : "off"}" data-intro="${intro ? "on" : "off"}"
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Postboi Mail</title>
<style>${THEME_CSS}</style>
<style>${CSS}</style>
</head>
<body>
<!-- The tube's silhouette: a rounded rect whose four edges bow outward. In
     objectBoundingBox units (0..1), so it stretches to whatever the window is. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
	<!-- Barrel distortion. The map is drawn at runtime (see build_warp) because the offsets
	     depend on the screen's aspect ratio, which CSS can't express in a gradient. -->
	<filter id="barrel" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
		<feImage id="warpmap" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>
		<feDisplacementMap id="warpdisp" in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/>
	</filter>
	<clipPath id="tube" clipPathUnits="objectBoundingBox">
		<path d="M .018 .040
			C .30 .003, .70 .003, .982 .040
			C .997 .30, .997 .70, .982 .960
			C .70 .997, .30 .997, .018 .960
			C .003 .70, .003 .30, .018 .040 Z"/>
	</clipPath>
</defs></svg>
<div id="bezel">
<div id="screen">
<div id="warp">

	<div id="aol" class="window">
		<div class="title-bar">
			<div class="title-bar-text"><span>&#9650;</span> Postboi Local</div>
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
				<button class="tb" id="t-crt"><span class="ico">&#128250;</span>CRT</button>
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
					<div class="title-bar-text"><span>&#9650;</span> Your Local Mailbox</div>
					<div class="title-bar-controls">
						<button aria-label="Minimize" data-act="min"></button>
						<button aria-label="Maximize" data-act="max"></button>
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
					<div id="ad">
						<div class="hd">&#9209; Speed Up Your Connection</div>
						<div class="bd">
							<div class="meter"><i></i></div>
							Slow &#183;&#183;&#183;&#183;&#183;&#183;&#183;&#183;&#183;&#183;&#183; Fast
						</div>
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
		<button id="start"><span>&#9783;</span> Start</button>
		<span id="tasks" style="display:flex;gap:4px"></span>
		<span class="spacer"></span>
		<!-- The count lives out here rather than in the mailbox header, which is the first
		     thing hidden when a message is open. -->
		<span id="count" style="padding:3px 9px"></span>
		<span id="stat" style="padding:3px 9px">Waiting for mail&#8230;</span>
		<span id="clock"></span>
	</div>

	<div id="startmenu">
		<div class="rail">Postboi&nbsp;98</div>
		<ul>
			<li id="m-refresh"><span class="ico">&#128260;</span>Check Mail Now</li>
			<li id="m-crt"><span class="ico">&#128250;</span>Toggle CRT</li>
			<li id="m-docs"><span class="ico">&#128218;</span>Help&#8230;</li>
			<li class="sep"></li>
			<li id="m-shutdown"><span class="ico">&#9211;</span>Shut Down&#8230;</li>
		</ul>
	</div>

	<div id="intro">
		<div id="introwin" class="child window">
			<div class="title-bar">
				<div class="title-bar-text"><span>&#9650;</span> Connecting To Postboi&#8230;</div>
				<div class="title-bar-controls"><button aria-label="Close" data-act="close"></button></div>
			</div>
			<div id="introbody">
				<div id="intrologo"><i>&#128238;</i><span>post</span><b>boi</b></div>
				<div id="steps">
					<div class="step" id="s0"><div class="box"></div><span class="cap">1. Locating mailroom&#8230;</span></div>
					<div class="step" id="s1"><div class="box"></div><span class="cap">2. Connecting to localhost&#8230;</span></div>
					<div class="step" id="s2"><div class="box"></div><span class="cap">3. Intercepting outgoing mail&#8230;</span></div>
				</div>
				<div id="introfoot"><button class="aolbtn" id="intro-cancel">Cancel</button></div>
			</div>
		</div>
	</div>

	<div id="shutdown">
		<div>
			It&#8217;s now safe to turn off<br>your computer.
			<small>(Your mail is still in the inbox. Click anywhere.)</small>
		</div>
	</div>

</div>

	<div id="mask-h"></div>
	<div id="mask-v"></div>
	<div id="roll"></div>
	<div id="vig"></div>
	<div id="grain"></div>
</div>
</div>
<script>${SCRIPT}</script>
</body>
</html>`
}
