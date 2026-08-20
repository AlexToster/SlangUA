# Як натягнути «Різограф» на проект, нічого не зламавши

План на узгодження. **У `frontend/` нічого не змінено** — це лише документ поряд із макетом
`mockups/translate-riso.html`. Кожна фаза — окремий коміт у гілці `feature/riso-ui`, кожну можна
відкотити окремо.

## Головна ідея

Не переписувати компоненти, а **перенаправити токени, які вони вже читають**. У `frontend/src` є
34 місця з `box-shadow`, 3 з `--color-divider-strong`, 7 з `--shadow-*`. Якщо в `global.css`
записати

```css
--shadow-sm: 4px 4px 0 var(--offset);
--shadow-lg: 6px 6px 0 var(--offset);
--color-divider-strong: var(--stroke);
```

то всі наявні консюмери одразу друкують жорсткий зсув замість розмитої тіні — **без жодного
редагування компонентів**. Тому фаза 1 (один файл, ~120 рядків) дає більшу частину вигляду, і
відкат — це `git revert` одного коміта. Перейменування токенів (`--shadow-*` → `--offset-*`)
робимо в кінці, коли вигляд уже прийнято, окремим косметичним комітом.

## Що перевірено в коді (щоб план стояв на фактах, а не на пам'яті)

- `global.css` імпортується **останнім** у `App.tsx:12`, тож він перекриває будь-яке правило
  компонента з такою ж специфічністю. Усі перевизначення компонентів мусять мати специфічність
  не нижчу.
- `TranslatePage.tsx:478-503`: `StyleDropdown` і `PreviewResult` — **безумовні сусідні діти**
  `section.translate-output`. Між ними ніколи нічого не з'являється в жодному стані. Отже хвостик
  результату можна прив'язати до кнопки стилю **без зміни розмітки**.
- Уся варіативність станів (empty / loading / updating / error / success) — усередині
  `PreviewResult`, не на сторінці.
- `PreviewResult.css`, `TextInput.css`, `StyleDropdown.css`, `TranslatePage.css`, `BottomNav.css`
  **не використовують `::before`/`::after` взагалі** — псевдоелемент під хвостик вільний.
- Реального «часу виконання» в UI немає: у `.preview-meta` лише `.preview-style` (бейдж) і
  `.preview-provider` (модель, `PreviewResult.tsx:150-151`). Макет виправлено — час прибрано.
- Тестів для `pages/**` немає жодного: `TranslatePage` не покритий, тож фаза 3 нічого не ламає
  автоматично — тільку очима.
- Візуальних тестів (Playwright / Storybook / скріншоти) у репозиторії немає взагалі.
- `--bottom-nav-height: 48px` об'явлено один раз (`BottomNav.css:5`) і продубльовано як fallback
  у `AppLayout.css:38` і `Toast.css:18`.
- У «Системній» темі `utils/localSettings.ts:87-93` пише 7 кольорів Telegram **інлайном на
  `<html>`**, тобто вище за будь-який стилелист.

## Фаза 0 — ремонт того, що фаза 1 не поглинає

Файли: `global.css`, `ErrorBanner.css`.

З 12 неоголошених змінних 8 зникають самі, бо фаза 1 прибирає всю сім'ю `--tg-*-alpha-*` і
`--shadow-*`. Лишається чотири справжні дірки, які треба заткнути до всього іншого, бо вони
**ламають вигляд уже сьогодні**:

1. `--tg-warning-color` / `--color-warning-alpha-*` — без них `.error-banner-offline` і
   `.error-banner-rate_limited` втрачають і фон, і рамку й виглядають як звичайна помилка.
2. `--color-text-muted` (11 посилань) — оголосити.
3. `--color-on-primary` (7) — оголосити.
4. `--font-mono` (1, `.preview-provider`) — оголосити.

Плюс прибрати дубль `.error-banner` (`global.css:411-420` перекриває `ErrorBanner.css:2-11`) і
5 мертвих правил `.error-banner-*`, яких `ErrorBanner.tsx` не рендерить.

Ризик: `ErrorBanner.test.tsx:24` перевіряє **точну рівність** `className === 'error-banner'` —
жодного класу додавати не можна, лише прибирати CSS. `:19` перевіряє
`toHaveClass('error-banner-rate_limited')` — сам клас лишається.

## Фаза 1 — тільки шар токенів (`global.css`, один файл)

```css
:root {
  --paper: #f2eee4;  --ink: #141210;  --stroke: var(--ink);
  --face: #e6dcc3;                  /* плашка кнопки — ніколи не колір тла */
  --offset: #d98a0b;                /* бурштин: на теплому папері жовтий не читається */
  --sun: #f7c948;  --flare: #ff4a6e;
  --color-primary: #2b4bd8;         /* один тон на обидві теми замість #2563eb / #0a84ff */
  --color-text-muted: color-mix(in srgb, var(--ink) 52%, var(--paper));
  --shadow-sm: 4px 4px 0 var(--offset);
  --shadow-lg: 6px 6px 0 var(--offset);
  --color-divider-strong: var(--stroke);
}
[data-theme='dark'] {
  --paper: #131210; --ink: #f2eee4; --face: #2a2622; --offset: var(--sun);
  --color-primary: #8fa6ff;
}
```

`--color-bg`, `--color-surface`, `--color-text`, `--color-border` стають псевдонімами
`--paper` / `--ink` / `--stroke`, тож жоден компонент не треба чіпати. Блок
`@media (prefers-color-scheme: dark)` мусить повторювати `[data-theme='dark']` рядок у рядок —
сьогодні там 10 задубльованих оголошень, і саме там найлегше розійтися.

### Одне рішення, без якого фаза 1 не має сенсу

У «Системній» темі Telegram інлайном підставляє свій `bg_color`, `text_color`, `button_color` —
і паперу з фарбою просто не буде видно: застосунок стане сірим Telegram-діалогом. Пропоную
брати з Telegram **лише світло/темно**, а фарби завжди друкувати свої (такий прецедент у проекті
вже є — `--color-tile-*` теж літеральні). Технічно це видалити цикл
`localSettings.ts:88-90`, який пише 7 властивостей; рядок `data-theme` з яскравості фону
лишається. Тестів на `applyTheme` немає, `telegram.test.ts` покриває тільки буфер обміну.

## Фаза 2 — примітиви (`global.css` + 5 файлів компонентів)

- Одна плашка: кожна кнопка отримує `background: var(--face)`, головна — `var(--color-primary)`.
  Це прибирає 6 різних «outlined primary» на 5 висотах і 2 радіусах.
- Один стан натискання на весь застосунок: `box-shadow: 0 0 0 var(--offset)` +
  `transform: translate(4px, 4px)` замість чотирьох різних `scale()` (0.92 / 0.95 / 0.97 / 0.98,
  11 місць) і трьох різних `opacity` для `:disabled` (0.4 / 0.5 / 0.6).
- Мінімальні розміри: 44px на всіх чипах, 48px на рядку дій. Сьогодні з 24 інтерактивних
  елементів 17 менші за 44px, чого вимагає `plans/docs/08-frontend-design.md` §10.
  Найдрібніші: `.admin-inline-btn` ≈19px, `.preview-action-btn` ≈24px на телефоні,
  `.error-banner-retry` ≈22px, `.retry-btn` ≈25px.
- Глобальний скид анімацій: `@media (prefers-reduced-motion: reduce)` сьогодні є в 3 файлах із
  ~17 анімованих контекстів. Додати один загальний блок у `global.css`.
- Прибрати `background: white` у `SettingsPage.css:171` (пімпочка тумблера, сліпа до теми) і
  розбіжний fallback `var(--color-error, #d92d20)` у `StyleDropdown.css:319`.

Тести, які тут поруч, але не ламаються: `TextInput.test.tsx` перевіряє `data-testid="char-counter"`
і класи `warning` / `error` / `over-limit` / `warning-zone` — усі лишаються;
`StyleDropdown.test.tsx` — `.style-dropdown-item.highlighted` і `.locked` — лишаються.

## Фаза 3 — екран перекладу (CSS + один вузол розмітки)

`TranslatePage.css` розбирає злиту картку на два блоки, і хвостик малює псевдоелемент:

```css
.translate-output { border: none; background: transparent; gap: var(--spacing-sm); }
.translate-output .style-dropdown-trigger {           /* окрема пігулка */
  border: 2px solid var(--stroke); border-radius: 999px;
  background: var(--face); box-shadow: var(--shadow-sm);
}
.translate-output .preview-result {                   /* окремий блок на всю ширину */
  position: relative; border: 2px solid var(--stroke);
  border-radius: var(--radius-lg); background: var(--paper);
  box-shadow: var(--shadow-lg);
}
.translate-output .preview-result::before {           /* хвостик угору, під кружком обличчя */
  content: ''; position: absolute; left: 19px; top: -9px; width: 14px; height: 14px;
  background: var(--paper); border-left: 2px solid var(--stroke);
  border-top: 2px solid var(--stroke); transform: rotate(45deg);
}
.translate-output .preview-result.empty::before { display: none; }
```

19px, бо `left` відлічується від внутрішнього краю рамки: центр кружка обличчя стоїть на
2px (рамка) + 5px (відступ пігулки) + 21px (радіус) = 28px від краю блока, отже 28 − 2 − 7 = 19.
Це єдине число, яке зв'язує два блоки, тому кнопка стилю мусить лишатися **безпосередньо над**
результатом у всіх станах (сьогодні так і є, `TranslatePage.tsx:479-502`).

`.translate-output.active` лишається як клас, але замість синього світіння
(`box-shadow: 0 0 0 3px`) міняє колір рамки результату на `--color-primary`; `animation` і
`translate-accent-flow` зникають — розмитих тіней у різографі немає. Передача акценту
`.text-input-wrapper:focus-within ~ .translate-output.active` (`TranslatePage.css:83`) працює
далі, бо порядок сусідів не змінюється.

### Кругле превью обличчя — єдина зміна розмітки в усьому плані

Зараз превью — прямокутник: `width: 64px; height: auto; object-fit: cover; align-self: stretch`
(`StyleDropdown.css:69-77`). Обличчя треба в колі й крупніше, а цього не дає ні `object-fit`
(з 4:3 у квадрат він дає лише 133% замість потрібних 185%), ні `object-view-box` (Safari/iOS
його не має). Тому — обгортка на 42px:

```tsx
<span className="style-thumb-crop" data-style={selectedStyleObj?.id}>
  <img className="style-dropdown-trigger-thumb" ... />
</span>
```

```css
.style-thumb-crop { position: relative; flex: 0 0 auto; width: 42px; height: 42px;
                    border-radius: 50%; overflow: hidden; border: 2px solid var(--stroke); }
/* height:185% + width:auto = точний аналог background-size: auto 185%;
   пара left/top + translate тих самих відсотків = семантика background-position. */
.style-thumb-crop img { position: absolute; height: 185%; width: auto;
                        left: var(--fx); top: var(--fy);
                        transform: translate(calc(-1 * var(--fx)), calc(-1 * var(--fy))); }
.style-thumb-crop[data-style='GEN_Z']    { --fx: 51%; --fy: 5%; }
.style-thumb-crop[data-style='STREET']   { --fx: 48%; --fy: 4%; }
.style-thumb-crop[data-style='IT_SLANG'] { --fx: 32%; --fy: 6%; }
.style-thumb-crop[data-style='KANCLER']  { --fx: 45%; --fy: 13%; }
.style-thumb-crop[data-style='POFENI']   { --fx: 41%; --fy: 9%; }
.style-thumb-crop[data-style='GALICIAN'] { --fx: 32%; --fy: 8%; }
```

`onError`-фолбек на lucide-іконку працює далі — обгортка не змінює логіки. Тестів на превью немає.
185% — це мінімум: у `street` і `gen-z` обличчя стоїть так високо, що при 167% вікно кадру фізично
не дотягується. Числа виміряні рендером кадру з перехрестям, а не на око.

При цьому старі правила самого `img` треба знеструмити: `width: 64px`, `align-self: stretch`,
`border-right` і `border-radius` (`StyleDropdown.css:70-77`) плюс перевизначення радіуса в
`TranslatePage.css:123-125` більше не потрібні — інакше вони битимуться з обгорткою.

## Фаза 4 — решта екранів

`HistoryPage.css` (404 рядки), `SettingsPage.css` (267), `AdminPage.css` (356), `SelectField.css`,
`Toast.css`, `ErrorBanner.css`, `LoadingScreen.css`. Тут переважно вже нічого не треба, бо зсув і
розділювачі прийдуть із токенів. Лишається ручна робота:

- три однакові «липкі» заголовки сторінок звести в одне правило;
- 6 копій `@keyframes spin` і 6 `.loading-spinner` (3 розміри) звести в одну;
- дублі `.skeleton-line`, `.spinner-sm`, `.visually-hidden` та байт-в-байт однакові
  `.settings-section-title` / `.admin-section-title`;
- два різні затемнення підкладки: `rgba(0,0,0,.5)` (`global.css:469`) і `rgb(0 0 0 / 45%)`
  (`TranslatePage.css:158`);
- `--color-text-secondary` (#64748b) на світлому тлі дає 4,24:1 і не проходить AA — це колір
  оригінальної фрази в Історії, 18px; замінюється на `color-mix` від `--ink`;
- `HistoryPage.css:266` має комент, що його кнопки 32×32 відповідають мінімуму — не відповідають.

## Фаза 5 — нижня навігація (потрібне окреме «так»)

Скло (`backdrop-filter`) і неоновий glow → паперова смуга, рамка 2px, активна вкладка — залита
плашка, ліва іконка — домівка. Ви раніше сказали навігацію не чіпати, тому вона окремо й останньою.

Тут єдине справді небезпечне місце в усьому плані, і воно не в CSS: `StyleDropdown.tsx:45-49`
шукає смугу через `document.querySelector('.bottom-nav')` і міряє `getBoundingClientRect().top`,
щоб панель стилів не залізла під неї. `StyleDropdown.test.tsx:248-275` підробляє цей вузол і
перевіряє точні значення `--style-dropdown-max-h: 784px`, `--style-dropdown-pad-b: 92px` / `0px`.
Отже: клас `.bottom-nav` не перейменовувати, висоту тримати 48px, `--bottom-nav-height` і два
його fallback-и (`AppLayout.css:38`, `Toast.css:18`) правити разом. `BottomNav.test.tsx:44-46`
вимагає, щоб усередині лишилися `.bottom-nav-glyph svg` і `.visually-hidden`, а `:45` перевіряє
`link.textContent === name` — тобто **видимого підпису під іконкою додавати не можна**.

## Інваріанти, які не можна порушити ні в якій фазі

1. `.app-layout` не скролиться (`height: 100dvh; overflow: hidden`), єдиний скрол-контейнер —
   `.app-layout-content`, смуга навігації — `position: absolute; bottom: 0` усередині оболонки.
2. `.translate-output` **не отримує `overflow: hidden`** — це обріже панель вибору стилю, яка
   відкривається вниз і мусить лягати поверх результату. Саме тому радіуси там навішені на дітей.
3. Панель стилів: `overflow-y: auto`, виміряна `max-height` і **дві колонки**. `COLUMNS = 2`
   (`StyleDropdown.tsx:9-10`) мусить дорівнювати `grid-template-columns: repeat(2, 1fr)` —
   інакше падають 6 тестів навігації стрілками, які захардкодили підписи.
4. `<img>` з атрибутами `width`/`height` завжди має `height: auto` в CSS, інакше зображення
   розтягується (це вже виправлений колись баг, комент у `StyleDropdown.css:257-261`).
5. `.text-input-wrapper` лишається попереднім сусідом `.translate-output`, бо на цьому тримається
   передача акценту через `~`.
6. `global.css` імпортується останнім — перевизначення в компонентах мусять бути не слабші за
   специфічністю. У проекті **нуль `!important`**, і так має лишитися.
7. Форматування чисел і дат — завжди з явним `'uk-UA'` (інакше CI з локаллю en-US падає, як уже
   було з `TextInput.test.tsx`).
8. Усі файли — **LF**. Після редагування прогнати `git ls-files -z | xargs -0 grep -lI $'\r'`:
   вивід мусить бути порожній.

## Гейти після кожної фази

У `frontend/`: `npm run lint`, `npm run test -- --run`, `npm run build`. У корені:
`npm run test:typecheck`. Усе це **на Windows** — у моїй пісочниці `oxlint`, `vitest` і `git push`
не запускаються, як і браузер, тож жоден макет я показати в рендері не можу.

Очима, бо автотестів на вигляд немає взагалі: 4 екрани × 3 теми (світла, темна, «Системна»),
ширини 390px і 320px, панель стилів відкрита і закрита, стани `empty` / `loading` / `updating` /
`error` / `success`, видимий фокус із клавіатури, `prefers-reduced-motion`.

## Що потрібно вирішити до початку

1. **«Системна» тема.** Брати з Telegram лише світло/темно, а фарби завжди свої (рекомендую), або
   лишити підстановку кольорів Telegram і змиритися, що на цій темі різографа не видно.
2. **Фаза 5 (навігація)** — робимо чи навігація лишається як є.
3. **Порядок.** Пропоную злити фази 0 і 1 в один коміт (обидві — лише `global.css` плюс
   `ErrorBanner.css`) і показати результат до того, як чіпати компоненти: це найдешевша точка,
   де ще можна сказати «не те».
