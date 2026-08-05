/**
 * The dev inbox's UI: one self-contained document, no build step, no dependencies. It's
 * dressed as AOL 4.0 on Windows 98 because a local mail client that looks nothing like
 * production mail is a feature — you can never mistake a screenshot of this for the real
 * thing.
 *
 * Hand-rolled rather than pulled from 98.css/XP.css: the document is served as a single
 * string with no bundler and no CDN, so a stylesheet would have to be vendored whole, and
 * the bevels below are the part those libraries would actually be supplying.
 */

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

/* Win95/98 bevels: light source top-left, two tones each way. */
.raised { border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff }
.sunken { border: 2px solid; border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000 }
.thin-sunken { border: 1px solid; border-color: #808080 #fff #fff #808080 }

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
#screen { position: relative; height: 100%; overflow: hidden; background: #3a6ea5; display: flex; flex-direction: column }
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
	/* The corners are the deepest part of the clip, so the UI is inset past them — otherwise
	   the curve eats the title bar and the taskbar. */
	padding: 34px 24px;
	filter:
		drop-shadow(0 0 2px #000)
		drop-shadow(0 0 26px rgba(70,150,220,.34))
		drop-shadow(0 20px 60px rgba(0,0,0,.9));
}
/* Bloom, plus the pen's glow-and-fringe text-shadow. Applied to light text on dark only:
   on the black-on-grey of the Windows chrome, a currentColor glow is a black smudge. */
.crt #aol { filter: contrast(1.1) saturate(1.18) brightness(1.05) }
.crt .titlebar, .crt #folders button, .crt #tabs button, .crt .band.b5 span, .crt #shutdown {
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
.titlebar {
	display: flex; align-items: center; gap: 5px; padding: 3px 3px 3px 4px;
	background: linear-gradient(90deg, #000080, #1084d0);
	color: #fff; font-weight: bold;
}
.titlebar.dim { background: linear-gradient(90deg, #7f7f7f, #b5b5b5) }
.titlebar .spacer { flex: 1 }
.titlebar .box {
	width: 17px; height: 15px; background: #c0c0c0; color: #000; cursor: default;
	font: bold 10px "MS Sans Serif", Tahoma, sans-serif; line-height: 12px; text-align: center;
	border: 1px solid; border-color: #fff #000 #000 #fff; padding: 0;
}

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
/* Two child windows, tiled rather than stacked. AOL would have floated the mail on top of
   the list, but a reader covering the thing you click to change messages is just a bug. */
#mailbox { position: absolute; left: 10px; right: 10px; top: 10px; bottom: 10px }
.reading #mailbox { bottom: 47% }
/* The wordmark and the ad are the first things to go when there's a message to read. */
.reading #mbhead { display: none }

/* Mailbox header: wordmark, the security reminder, and the ad slot that was always there. */
#mbhead { display: flex; align-items: flex-start; gap: 14px; padding: 10px 12px; background: #fff }
#mbhead .mark { display: flex; align-items: center; gap: 8px; color: #000080 }
#mbhead .mark span { font: italic bold 26px Georgia, "Times New Roman", serif; letter-spacing: -.5px }
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
#folders { display: flex; gap: 3px; padding: 6px 10px 0; background: #003399 }
#folders button {
	padding: 5px 16px 6px; cursor: pointer; background: #7f9fcf; color: #eaeef8; font-weight: bold;
	border: 0; border-radius: 7px 7px 0 0;
}
#folders button.on { background: #fff; color: #003399 }
#listwrap { padding: 0 10px 8px; background: #003399; flex: 1; min-height: 0; display: flex }
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
#actions { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #c0c0c0 }
#actions .spacer { flex: 1 }
.aolbtn {
	min-width: 92px; padding: 4px 14px; cursor: pointer; background: #b6c6de; color: #000080; font-weight: bold;
	border: 2px solid; border-color: #fff #6a7a94 #6a7a94 #fff;
}
.aolbtn:active { border-color: #6a7a94 #fff #fff #6a7a94 }
.aolbtn[disabled] { color: #808080; cursor: default }

/* The reader opens as its own child window, the way AOL opened mail. */
#reader { position: absolute; left: 10px; right: 10px; top: 54%; bottom: 10px; z-index: 20; display: none }
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

/* ---- Taskbar and Start menu ---- */
#taskbar { display: flex; align-items: center; gap: 4px; padding: 2px 3px; background: #c0c0c0; border-top: 1px solid #dfdfdf; margin: 0 2px 2px }
#start {
	display: flex; align-items: center; gap: 4px; padding: 2px 7px 3px 4px; font-weight: bold; cursor: pointer; background: #c0c0c0;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
#start.on { border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000 }
#taskbar .task { flex: 0 1 190px; text-align: left; padding: 3px 8px; background: #c0c0c0; cursor: default; font-weight: bold;
	border: 2px solid; border-color: #808080 #fff #fff #808080 }
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
		? "AOL: You Have Mail! (" + unread + " new)"
		: "AOL: Welcome, POSTBOI!"
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
	$("workspace").className = current ? "reading" : ""
	if (!current) {
		reader.className = "child raised"
		return
	}
	reader.className = "child raised open"
	$("reader-title").textContent = current.subject || "(no subject)"
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
	if (muted) return
	var audio = new Audio(api + "/sounds/" + name)
	audio.volume = 0.7
	// Browsers refuse audio until the page has been interacted with. That's a promise
	// rejection, not an error worth surfacing — the next one will play.
	var played = audio.play()
	if (played && played.catch) played.catch(function () {})
}

function apply_mute(on) {
	muted = on
	var button = $("t-sound")
	button.className = on ? "tb" : "tb on"
	button.firstChild.textContent = on ? "\\u{1F507}" : "\\u{1F50A}"
	button.lastChild.nodeValue = on ? "Muted" : "Sound"
}

/* ---- Toolbar and action wiring ---- */
$("tabs").onclick = function (event) {
	if (!event.target.dataset || !event.target.dataset.tab) return
	tab = event.target.dataset.tab
	render_reader()
}
$("reader-close").onclick = function () { current = null; render_list(); render_reader() }
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
	$("intro").className = ""
	play("welcome")
}
function run_intro() {
	$("intro").className = "open"
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
<style>${CSS}</style>
</head>
<body>
<!-- The tube's silhouette: a rounded rect whose four edges bow outward. In
     objectBoundingBox units (0..1), so it stretches to whatever the window is. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
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

	<div id="aol" class="raised">
		<div class="titlebar">
			<span>&#9650;</span>
			<span>America&nbsp; Online</span>
			<span class="spacer"></span>
			<span class="box">_</span><span class="box">&#9633;</span><span class="box">&times;</span>
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
			<div class="band b5"><span style="color:#fff;font:italic bold 15px Arial,sans-serif">AOL.</span></div>
		</div>

		<div id="nav">
			<button class="rnd">&#9664;</button><button class="rnd">&#9654;</button>
			<button class="rnd">&#10006;</button><button class="rnd">&#8635;</button>
			<button class="rnd">&#8962;</button>
			<span class="pill">Find &#9662;</span>
			<span id="address" class="thin-sunken">AOL: Welcome, POSTBOI!</span>
			<span class="pill">Go</span><span class="pill">Keyword</span>
		</div>

		<div id="workspace">
			<div id="mailbox" class="child raised">
				<div class="titlebar">
					<span>&#9650;</span>
					<span>POSTBOI's Online Mailbox</span>
					<span class="spacer"></span>
					<span class="box">_</span><span class="box">&#9633;</span><span class="box">&times;</span>
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
			</div>

			<div id="reader" class="child raised">
				<div class="titlebar">
					<span>&#9993;</span>
					<span id="reader-title"></span>
					<span class="spacer"></span>
					<button class="box" id="reader-close">&times;</button>
				</div>
				<div id="head"></div>
				<div id="tabs">
					<button data-tab="html" class="on">Message</button>
					<button data-tab="text">Plain Text</button>
					<button data-tab="source">Source</button>
					<button data-tab="files">Attachments</button>
				</div>
				<div id="pane" class="thin-sunken"></div>
			</div>
		</div>
	</div>

	<div id="taskbar">
		<button id="start"><span>&#9783;</span> Start</button>
		<span class="task">&#9650; America Online</span>
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
		<div id="introwin" class="child raised">
			<div class="titlebar">
				<span>&#9650;</span><span>Connecting To Postboi&#8230;</span><span class="spacer"></span>
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
