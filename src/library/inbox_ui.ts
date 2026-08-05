/**
 * The dev inbox's UI: one self-contained document, no build step, no dependencies. It's
 * dressed as mid-90s AOL because a local mail client that looks nothing like production
 * mail is a feature — you can never mistake a screenshot of this for the real thing.
 */

const CSS = `
* { box-sizing: border-box }
body {
	margin: 0; padding: 0; height: 100vh; overflow: hidden;
	background: #0a0b0c;
	font: 12px "MS Sans Serif", Tahoma, Geneva, Verdana, sans-serif;
	color: #000;
	-webkit-font-smoothing: none;
}

/*
 * The CRT. Everything below is decoration over a normal DOM — no canvas, no shader, because
 * the message preview is an iframe and you can't put an iframe through a fragment shader.
 * All of it hangs off .crt on <html> so the toolbar toggle is one class away.
 */
#bezel {
	height: 100vh; padding: 18px;
	background: radial-gradient(120% 90% at 50% 0%, #23262a, #101113 60%, #0a0b0c);
}
.crt #bezel {
	padding: 26px;
	background:
		radial-gradient(120% 90% at 50% 0%, #2a2d31, #141517 55%, #0a0b0c),
		#0a0b0c;
}
#screen {
	position: relative; height: 100%; overflow: hidden;
	background: #008080;
	padding: 12px;
}
/* Curvature is faked: a rounded, inset-lit tube plus the vignette below. Real barrel
   distortion would need a shader, and would bend the mail you're trying to read. */
.crt #screen {
	border-radius: 26px / 38px;
	box-shadow:
		0 0 0 2px #000,
		0 0 0 12px #17191c,
		0 0 0 13px #34383d,
		inset 0 0 30px rgba(0, 0, 0, .5),
		inset 0 0 90px rgba(0, 0, 0, .35),
		/* Light spilling onto the bezel is what reads as "emitting", more than any overlay. */
		0 0 60px 6px rgba(0, 210, 200, .30),
		0 0 160px 40px rgba(0, 150, 160, .20),
		0 26px 80px rgba(0, 0, 0, .85);
}
/* Bloom + a touch of chromatic fringing, the two things shader.se actually does. */
.crt #window { filter: contrast(1.12) saturate(1.2) brightness(1.06) }
.crt #title, .crt #gotmail .shout, .crt #count { text-shadow: .4px 0 rgba(255,0,60,.45), -.4px 0 rgba(0,190,255,.45), 0 0 6px rgba(180,220,255,.28) }

#crt { display: none }
.crt #crt {
	display: block; position: absolute; inset: 0; z-index: 90; pointer-events: none;
	border-radius: 22px / 32px;
}
/* Scanlines (3px pitch) and the aperture-grille mask, in one layer each. */
.crt #crt::before {
	content: ""; position: absolute; inset: 0;
	background:
		repeating-linear-gradient(0deg, rgba(0,0,0,.26) 0 1.5px, rgba(0,0,0,0) 1.5px 3px),
		/* Kept faint: at the .05 it wants to be, the mask greys the whole picture out. */
		repeating-linear-gradient(90deg, rgba(255,0,0,.03) 0 1px, rgba(0,255,0,.03) 1px 2px, rgba(0,0,255,.03) 2px 3px);
	animation: flicker 6.5s steps(1) infinite;
}
/* Vignette, plus the glass highlight that sells the curve more than the radius does. */
.crt #crt::after {
	content: ""; position: absolute; inset: 0;
	background:
		/* Corner falloff does the work curvature can't: an ellipse tighter than the box, so
		   the four corners darken hardest — the shape a tube actually has. */
		radial-gradient(ellipse 78% 76% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.34) 80%, rgba(0,0,0,.85) 100%),
		linear-gradient(198deg, rgba(255,255,255,.13) 0%, rgba(255,255,255,.03) 20%, rgba(255,255,255,0) 38%);
}
/* The slow vertical roll of a tube slightly out of sync. */
.crt #roll {
	position: absolute; left: 0; right: 0; height: 34%; z-index: 91; pointer-events: none;
	background: linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.035) 50%, rgba(255,255,255,0) 100%);
	animation: roll 7s linear infinite;
}
@keyframes flicker { 0%, 97% { opacity: 1 } 98% { opacity: .86 } 99% { opacity: 1 } 100% { opacity: .93 } }
@keyframes roll { 0% { top: -34% } 100% { top: 100% } }
/* Motion is the part that makes people ill; the static texture is harmless, so keep it. */
@media (prefers-reduced-motion: reduce) {
	.crt #crt::before { animation: none }
	.crt #roll { display: none }
}
/* Win95 bevels: light source top-left, two tones each way. */
.raised { border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff }
.sunken { border: 2px solid; border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000 }

#window { height: 100%; display: flex; flex-direction: column; background: #c0c0c0 }
#title {
	display: flex; align-items: center; gap: 6px; padding: 3px 3px 3px 4px; margin: 2px;
	background: linear-gradient(90deg, #000080, #1084d0);
	color: #fff; font-weight: bold; letter-spacing: .2px;
}
#title .spacer { flex: 1 }
#title .box {
	width: 17px; height: 15px; background: #c0c0c0; color: #000;
	font: bold 10px "MS Sans Serif", Tahoma, sans-serif; line-height: 11px; text-align: center;
	border: 1px solid; border-color: #fff #000 #000 #fff;
}
#menu { display: flex; gap: 2px; padding: 1px 4px; border-bottom: 1px solid #808080 }
#menu span { padding: 2px 7px }
#menu span u { text-decoration: underline }

#toolbar { display: flex; align-items: center; gap: 4px; padding: 4px; border-bottom: 1px solid #808080 }
button.tb {
	display: flex; flex-direction: column; align-items: center; gap: 1px;
	min-width: 54px; padding: 3px 6px 2px; background: #c0c0c0; cursor: pointer;
	font: 11px "MS Sans Serif", Tahoma, sans-serif;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
button.tb:active { border-color: #808080 #fff #fff #808080; box-shadow: inset -1px -1px 0 #dfdfdf, inset 1px 1px 0 #000; padding: 4px 5px 1px 7px }
button.tb .ico { font-size: 15px; line-height: 15px }
#toolbar .spacer { flex: 1 }
#count { padding-right: 6px; color: #000080; font-weight: bold }

/* The one thing everybody remembers. */
#gotmail { display: none; align-items: center; gap: 10px; padding: 7px 10px; margin: 6px 6px 0; background: #000080; color: #fff }
#gotmail.on { display: flex }
#gotmail .shout { font-size: 15px; font-weight: bold; font-style: italic; text-shadow: 1px 1px 0 #000 }
#gotmail .shout b { color: #fdc005 }
#gotmail .from { flex: 1; text-align: right; opacity: .85 }
@keyframes wave { 0%, 100% { transform: rotate(0) } 50% { transform: rotate(-11deg) } }
/* Only the flag waves — a wobbling mailbox reads as a rendering bug, not as delight. */
#gotmail .flag { animation: wave 1.5s ease-in-out infinite; transform-box: view-box; transform-origin: 28px 30px }

#body { flex: 1; display: flex; flex-direction: column; gap: 6px; padding: 6px; min-height: 0 }
#list { height: 38%; min-height: 92px; background: #fff; overflow: auto }
table { width: 100%; border-collapse: collapse; font: 12px "MS Sans Serif", Tahoma, sans-serif }
thead th {
	position: sticky; top: 0; z-index: 1; text-align: left; font-weight: normal;
	padding: 3px 6px; background: #c0c0c0;
	border-right: 1px solid #808080; border-bottom: 1px solid #808080;
	box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
tbody td { padding: 2px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
tbody tr { cursor: pointer }
tbody tr.unread td { font-weight: bold }
tbody tr.on td { background: #000080; color: #fff }
td.flag { width: 22px; text-align: center }
td.when { width: 118px }
td.who { width: 34% }
#empty { padding: 22px; text-align: center; color: #808080 }

#reader { flex: 1; display: flex; flex-direction: column; background: #c0c0c0; min-height: 0 }
#head { padding: 6px 8px; border-bottom: 1px solid #808080; background: #c0c0c0 }
#head .subject { font-weight: bold; font-size: 13px; margin-bottom: 3px }
#head dl { display: grid; grid-template-columns: max-content 1fr; gap: 1px 8px; margin: 0 }
#head dt { color: #000080; font-weight: bold }
#head dd { margin: 0; overflow: hidden; text-overflow: ellipsis }
#tabs { display: flex; gap: 2px; padding: 4px 6px 0 }
#tabs button {
	padding: 3px 11px; background: #c0c0c0; cursor: pointer;
	font: 12px "MS Sans Serif", Tahoma, sans-serif;
	border: 2px solid; border-color: #dfdfdf #000 #000 #dfdfdf; box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #fff;
}
#tabs button.on { background: #dfdfdf; font-weight: bold }
#pane { flex: 1; margin: 4px 6px 6px; background: #fff; min-height: 0; overflow: auto }
#pane iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff }
#pane pre { margin: 0; padding: 10px; font: 12px ui-monospace, "Courier New", monospace; white-space: pre-wrap; word-wrap: break-word }
#pane .files { padding: 10px }
#pane .files a { display: block; margin-bottom: 5px; color: #0000ee }
#blank { display: flex; height: 100%; align-items: center; justify-content: center; color: #808080; text-align: center; line-height: 1.7 }

#status { display: flex; gap: 4px; padding: 3px 4px 4px }
#status div { padding: 2px 6px; border: 1px solid; border-color: #808080 #fff #fff #808080 }
#status .grow { flex: 1 }
`

const SCRIPT = `
var base = location.pathname.replace(/\\/+$/, "")
var api = base + "/api"
var messages = []
var current = null
var tab = "html"
var seen = 0
var read = {}

function esc(value) {
	return String(value == null ? "" : value)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function who(list) {
	if (!list || !list.length) return ""
	return list.map(function (a) { return a.name ? a.name + " <" + a.address + ">" : a.address }).join(", ")
}
function when(ms) {
	var d = new Date(ms)
	var pad = function (n) { return (n < 10 ? "0" : "") + n }
	return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
}

function render_list() {
	var tbody = document.getElementById("rows")
	var empty = document.getElementById("empty")
	tbody.innerHTML = ""
	empty.style.display = messages.length ? "none" : "block"
	messages.forEach(function (m) {
		var tr = document.createElement("tr")
		if (!read[m.id]) tr.className = "unread"
		if (current && current.id === m.id) tr.className += " on"
		tr.innerHTML =
			'<td class="flag">' + (read[m.id] ? "\\u2709" : "\\u2b07") + "</td>" +
			'<td class="when">' + when(m.received_at) + "</td>" +
			'<td class="who">' + esc(who(m.to)) + "</td>" +
			"<td>" + esc(m.subject || "(no subject)") + "</td>"
		tr.onclick = function () { open_message(m) }
		tbody.appendChild(tr)
	})
	var unread = messages.filter(function (m) { return !read[m.id] }).length
	document.getElementById("count").textContent =
		messages.length + " message" + (messages.length === 1 ? "" : "s") + (unread ? ", " + unread + " new" : "")
	var banner = document.getElementById("gotmail")
	banner.className = unread ? "on" : ""
	document.getElementById("newest").textContent = unread && messages[0] ? "from " + who([messages[0].from]) : ""
	document.title = (unread ? "(" + unread + ") " : "") + "Postboi Mail"
	document.getElementById("stat").textContent = messages.length ? "Ready" : "Waiting for mail\\u2026"
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
	var head = document.getElementById("head")
	var pane = document.getElementById("pane")
	var tabs = document.getElementById("tabs")
	if (!current) {
		head.innerHTML = ""
		tabs.style.visibility = "hidden"
		pane.innerHTML = '<div id="blank">Welcome!<br>You have no mail selected.</div>'
		return
	}
	tabs.style.visibility = "visible"
	head.innerHTML =
		'<div class="subject">' + esc(current.subject || "(no subject)") + "</div><dl>" +
		row("From", who([current.from])) +
		row("To", who(current.to)) +
		row("Cc", who(current.cc)) +
		row("Bcc", who(current.bcc)) +
		row("Reply-To", who(current.reply_to)) +
		row("Sent", new Date(current.received_at).toLocaleString()) +
		"</dl>"

	Array.prototype.forEach.call(tabs.children, function (b) {
		b.className = b.dataset.tab === tab ? "on" : ""
	})

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
		if (messages.length > seen && seen > 0) chime()
		seen = messages.length
		render_list()
		render_reader()
	})
}

/** The modem-era two-tone, near enough. No audio file to ship. */
function chime() {
	try {
		var ctx = new (window.AudioContext || window.webkitAudioContext)()
		;[0, 0.18].forEach(function (at, i) {
			var osc = ctx.createOscillator()
			var gain = ctx.createGain()
			osc.type = "sine"
			osc.frequency.value = i ? 1046 : 784
			gain.gain.setValueAtTime(0.0001, ctx.currentTime + at)
			gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02)
			gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.16)
			osc.connect(gain).connect(ctx.destination)
			osc.start(ctx.currentTime + at)
			osc.stop(ctx.currentTime + at + 0.18)
		})
	} catch (e) {
		// No audio permission yet (nobody has clicked). Silence is fine.
	}
}

document.getElementById("tabs").onclick = function (event) {
	if (!event.target.dataset || !event.target.dataset.tab) return
	tab = event.target.dataset.tab
	render_reader()
}
document.getElementById("refresh").onclick = function () { load() }
document.getElementById("markall").onclick = function () {
	messages.forEach(function (m) { read[m.id] = true })
	render_list()
}
document.getElementById("clear").onclick = function () {
	if (!confirm("Delete every message in the inbox?")) return
	fetch(api + "/messages", { method: "DELETE" }).then(function () {
		current = null
		seen = 0
		read = {}
		load()
	})
}

/*
 * The tube is on by default, but scanlines over a message you're checking the design of are
 * the opposite of useful — so it's one click off, and the choice sticks.
 */
var crt_toggle = document.getElementById("crt-toggle")
function apply_crt(on) {
	document.documentElement.className = on ? "crt" : ""
	crt_toggle.style.fontWeight = on ? "bold" : "normal"
}
apply_crt(localStorage.getItem("postboi:crt") !== "off")
crt_toggle.onclick = function () {
	var on = document.documentElement.className !== "crt"
	localStorage.setItem("postboi:crt", on ? "on" : "off")
	apply_crt(on)
}

new EventSource(api + "/events").onmessage = function () { load() }
load()
`

/** The inbox document. Built per request — it's a dev server, and a string is cheap. */
export function inbox_ui(): string {
	return `<!doctype html>
<html lang="en" class="crt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Postboi Mail</title>
<style>${CSS}</style>
</head>
<body>
<div id="bezel">
<div id="screen">
<div id="window" class="raised">
	<div id="title">
		<span>&#9993;</span>
		<span>Postboi Mail &#8212; Online</span>
		<span class="spacer"></span>
		<span class="box">_</span><span class="box">&#9633;</span><span class="box">&times;</span>
	</div>
	<div id="menu"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>M</u>ail</span><span><u>H</u>elp</span></div>
	<div id="toolbar">
		<button class="tb" id="refresh"><span class="ico">&#128229;</span>Read</button>
		<button class="tb" id="markall"><span class="ico">&#9993;</span>Mark Read</button>
		<button class="tb" id="clear"><span class="ico">&#128465;</span>Delete All</button>
		<button class="tb" id="crt-toggle"><span class="ico">&#128250;</span>CRT</button>
		<span class="spacer"></span>
		<span id="count"></span>
	</div>

	<div id="gotmail">
		<svg width="46" height="34" viewBox="0 0 46 34" aria-hidden="true">
			<g class="flag">
				<path d="M27 30V4h3v26z" fill="#3a3a3a"/>
				<path d="M30 4h14l-4 4.5 4 4.5H30z" fill="#fdc005" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
			</g>
			<path d="M3 16a11 11 0 0 1 22 0v13H3z" fill="#e8e8e8" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
			<path d="M14 5v24" stroke="#000" stroke-width="2"/>
			<path d="M14 16a5.5 5.5 0 0 1 11 0v13H14z" fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
		</svg>
		<span class="shout">You've Got <b>Mail!</b></span>
		<span class="from" id="newest"></span>
	</div>

	<div id="body">
		<div id="list" class="sunken">
			<table>
				<thead><tr><th class="flag"></th><th class="when">Date</th><th class="who">To</th><th>Subject</th></tr></thead>
				<tbody id="rows"></tbody>
			</table>
			<div id="empty">Your online mailbox is empty.<br>Send something from your app and it will arrive here.</div>
		</div>

		<div id="reader" class="sunken">
			<div id="head"></div>
			<div id="tabs">
				<button data-tab="html" class="on">Message</button>
				<button data-tab="text">Plain Text</button>
				<button data-tab="source">Source</button>
				<button data-tab="files">Attachments</button>
			</div>
			<div id="pane" class="sunken"><div id="blank">Welcome!<br>You have no mail selected.</div></div>
		</div>
	</div>

	<div id="status">
		<div class="grow" id="stat">Waiting for mail&#8230;</div>
		<div>Postboi dev inbox</div>
	</div>
</div>
<div id="roll"></div>
<div id="crt"></div>
</div>
</div>
<script>${SCRIPT}</script>
</body>
</html>`
}
