# 05 — Arabic RTL and English LTR Behavior

**Default:** Arabic (`ar`), `dir=rtl`.\
**Secondary:** English (`en`), `dir=ltr`.\
**Rule:** the same information architecture and the same components, mirrored by direction — not separate layouts.

---

## 1. Document direction

```html
<html lang="ar" dir="rtl">
```

On language switch:

```js
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
```

Persist the choice in `localStorage` and restore before first paint to avoid a direction flash. The prototype does this in its boot script.

---

## 2. Logical layout rules

Use CSS logical properties everywhere:

| Avoid | Use |
|---|---|
| `margin-left` | `margin-inline-start` |
| `margin-right` | `margin-inline-end` |
| `padding-left` | `padding-inline-start` |
| `border-left` | `border-inline-start` |
| `left: 0` | `inset-inline-start: 0` |
| `right: 0` | `inset-inline-end: 0` |
| `text-align: left` | `text-align: start` |
| `border-radius: 8px 0 0 8px` | logical corner radii |

The rail moves to the right in RTL, the inspector to the left. The center column remains the primary reading column.

### Grid mirroring

```css
.app {
  grid-template-columns: var(--rail) minmax(0, 1fr) var(--inspector);
}
[dir="rtl"] .app {
  grid-template-columns: var(--inspector) minmax(0, 1fr) var(--rail);
}
```

On mobile, bottom navigation order mirrors automatically with `flex-direction: row` and logical order. Icons that encode direction (`ArrowRight`, `ChevronRight`, “back”) must be mirrored; semantic icons (`Play`, `Shield`, `Check`) must not.

Use a helper:

```css
[dir="rtl"] .icon-directional { transform: scaleX(-1); }
```

Never mirror:
- status icons;
- agent avatars;
- brand mark;
- code snippets;
- numbers;
- charts.

---

## 3. Bidi text handling

Operational data mixes Arabic objectives, English agent names, tool IDs, digests, and timestamps. The rules are explicit:

| Content | Direction | Markup |
|---|---|---|
| Mission objective | `auto` | `dir="auto"` |
| Task title | `auto` | `dir="auto"` |
| Agent name | `auto` | `dir="auto"` |
| Tool ID / package key | `ltr` | `<bdi dir="ltr">` or `.mono[dir=ltr]` |
| Mission ID / task ID / digest | `ltr` | `.mono.ltr` + `unicode-bidi: isolate` |
| Timestamps | locale-aware, isolated | `<time>` + `dir="ltr"` for ISO; localized display for UI |
| Code / exact command | `ltr` | `<pre dir="ltr">` |
| URL / repository | `ltr` | `.ltr` |
| Mixed sentence | `auto` with isolated tokens | `dir="auto"` + `<bdi>` |

CSS:

```css
.mono, code, pre, .bdi-ltr {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  unicode-bidi: isolate;
}
pre, code, .ltr { direction: ltr; text-align: left; }
```

Do not apply `direction: ltr` to a whole card that contains Arabic prose. Isolate the token, not the container.

---

## 4. Typography and Arabic specifics

- Use `IBM Plex Sans Arabic` for Arabic and Latin UI text to keep a single voice.
- Do not use uppercase transformation for Arabic labels; Arabic has no case.
- Do not apply positive letter-spacing to Arabic. It breaks joining behavior visually.
- Use line-height 1.6–1.7 for Arabic body text; Latin dense metadata can use 1.45.
- Use 600 weight for Arabic headings rather than 700; heavier weights can become muddy at small sizes.
- Use tabular numerals only for metrics. Arabic-Indic digits are not required; the product uses Western Arabic numerals consistently for IDs, counts, and timestamps to match the data.
- Keep code and digests in `IBM Plex Mono`; do not shape them as Arabic.
- Avoid italics for Arabic. Use weight or color for emphasis.

---

## 5. Component mirroring

| Component | RTL behavior |
|---|---|
| Rail | Right edge; active marker on the right |
| Inspector | Left side; header alignment start |
| Mission header | Text right-aligned; metadata flows right-to-left |
| Phase spine | Flows right-to-left; current phase anchored to the reading start |
| Task ledger | Index at the right; title and agent to the left of it; status at the far left |
| Tabs | Right-to-left order; underline follows |
| Timeline | Vertical line on the right; content to its left |
| Bottom nav | First zone (Brief) at the right |
| Sheet close | Top-left in RTL; top-right in LTR |
| Breadcrumb | Separator points in the reading direction |
| Progress bar | Fills from the right in RTL; percentage is LTR-isolated |

The prototype implements these with logical properties and explicit direction-aware markup.

---

## 6. Localization coverage

Every visible UI string is in a dictionary with `ar` and `en` values. No string is hardcoded in components except:

- IDs, tool names, package keys, digests;
- API-provided content (mission objective, task titles, agent names, evidence text);
- user-generated memory/artifact text.

The dictionary covers:

- zones and tabs;
- statuses and phases;
- attention and approval language;
- inspector sections;
- capability inventory and package metadata labels;
- runtime and security terms;
- empty/error/loading states;
- keyboard and accessibility labels.

---

## 7. Directional state examples

### Arabic, active mission

```text
مهمة · msn_ba1e…
بناء تطبيق ويب جاهز للإنتاج والتحقق منه بالاختبارات
بانتظار الموافقة    3/4     آخر تحديث 22:14
فهم ← تخطيط ← إسناد ← تنفيذ ← تحقق ← تسليم
```

### English, active mission

```text
MISSION · msn_ba1e…
Build a production-ready web app and verify it with tests
Awaiting approval    3/4    Updated 22:14
Understand → Plan → Assign → Execute → Verify → Deliver
```

### Arabic mixed-content row

```text
04  التحقق من مجموعة الاختبارات        QA Engineer        محظور
    host.exec · agt_…
```

The Arabic title reads RTL; the English agent and tool ID are isolated LTR tokens.

---

## 8. Testing checklist

- Switch AR → EN → AR without reload; direction, rail, inspector, and icon mirroring update.
- Mission objective with mixed Arabic + `scaffold.webapp` renders in the correct order.
- Tool IDs and digests never cause punctuation to jump.
- Task status labels and counts remain aligned in both directions.
- Mobile bottom nav order mirrors; the active indicator stays on the correct item.
- Approval sheet close button is on the correct side.
- Keyboard focus order follows visual reading order.
- No horizontal overflow at 320 px in either direction.
