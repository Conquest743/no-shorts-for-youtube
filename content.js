/**
 * No Shorts for YouTube — content script.
 *
 * Делает три вещи:
 *   1) перехватывает клики по ссылкам на Shorts и уводит на обычный плеер;
 *   2) следит за адресом внутри SPA и правит его, если всё же оказались в /shorts/;
 *   3) прячет элементы Shorts, до которых не дотянулся hide-shorts.css.
 *
 * Прямые заходы по URL (адресная строка, новая вкладка, F5, внешняя ссылка)
 * ловятся раньше — правилом declarativeNetRequest из rules.json.
 * Навигацию внутри SPA перехватывает history-hook.js в MAIN world.
 */
(() => {
  'use strict';

  const SHORTS_PATH = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/;
  const HIDDEN = 'nsfyt-hidden';
  const REDIRECT_COOLDOWN_MS = 1500;

  /** Одна ссылка ловит и относительные /shorts..., и абсолютные youtube.com/shorts... */
  const SHORTS_LINK = 'a[href*="/shorts"]';
  const USER_TEXT = 'ytd-comments, ytm-comments-entry-point-header-renderer, ' +
    'ytd-watch-metadata, ytm-expandable-video-description-body-renderer';

  /**
   * Контейнеры, которые прячем целиком, если внутри нашлась ссылка на Shorts.
   * Здесь и навигация, и карточки — правило одно: скрываем по адресу назначения,
   * а не по названию компонента.
   */
  const CONTAINER_SELECTOR = [
    // навигация
    'ytd-guide-entry-renderer',
    'ytd-mini-guide-entry-renderer',
    'ytm-pivot-bar-item-renderer',
    'yt-tab-shape',
    'tp-yt-paper-tab',
    'yt-chip-cloud-chip-renderer',
    // карточки
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-playlist-video-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'ytm-video-with-context-renderer',
    'yt-lockup-view-model'
  ].join(',');

  /**
   * Полки. Решение по ним принимает только isShortsShelf() — он проверяет,
   * что внутри нет обычных видео. Поэтому поиск контейнера отдельной ссылки
   * обязан останавливаться на этом уровне, иначе смешанная полка («Для вас»
   * и подобные) будет скрыта целиком вместе с нормальными роликами.
   */
  const SHELF_TAGS = new Set([
    'ytd-rich-shelf-renderer',
    'ytd-reel-shelf-renderer',
    'ytd-rich-section-renderer',
    'ytd-shelf-renderer',
    'ytm-reel-shelf-renderer',
    'grid-shelf-view-model'
  ]);

  const SHELF_SELECTOR = [...SHELF_TAGS].join(',');

  /** Каркас страницы — эти элементы прятать нельзя ни при каких условиях. */
  const NEVER_HIDE = new Set([
    'html', 'body', 'ytd-app', 'ytm-app', 'ytd-page-manager', 'ytd-browse',
    'ytd-watch-flexy', 'ytd-search', 'ytd-two-column-browse-results-renderer',
    'ytd-two-column-search-results-renderer', 'ytd-section-list-renderer',
    'ytd-item-section-renderer', 'ytd-rich-grid-renderer', 'ytd-rich-grid-row',
    'ytd-guide-renderer', 'ytd-guide-section-renderer', 'ytd-mini-guide-renderer',
    'ytd-tabbed-page-header', 'ytd-c4-tabbed-header-renderer', 'ytd-masthead'
  ]);

  /** Форма имени компонента YouTube — по ней ищем контейнер, если имя сменилось. */
  const GENERIC_CONTAINER = /-(renderer|view-model|shape)(-v\d+)?$/;

  /** Подпись вкладки/чипа/пункта меню YouTube локализует — сверяем по списку. */
  const SHORTS_LABELS = new Set(['shorts', 'шортсы', 'шорты', 'короткие видео']);

  let lastRedirectAt = 0;

  // ---------------------------------------------------------------- утилиты

  function videoIdFromPath(pathname) {
    const match = SHORTS_PATH.exec(pathname);
    return match ? match[1] : null;
  }

  /** Разбирает href ссылки: 'video' — конкретный Short, 'section' — раздел целиком. */
  function shortsLinkKind(href) {
    if (!href || !href.includes('/shorts')) return null;
    try {
      const url = new URL(href, location.origin);
      if (url.protocol !== 'https:' || !['www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return null;
      if (videoIdFromPath(url.pathname)) return 'video';
      if (/^\/(?:@[^/]+\/|(?:channel|c|user)\/[^/]+\/)?shorts\/?$/.test(url.pathname)) return 'section';
      return null;
    } catch {
      return null;
    }
  }

  function videoIdFromHref(href) {
    if (shortsLinkKind(href) !== 'video') return null;
    try {
      return videoIdFromPath(new URL(href, location.origin).pathname);
    } catch {
      return null;
    }
  }

  function watchUrl(id) {
    return `${location.origin}/watch?v=${id}`;
  }

  function reportBlocked() {
    try {
      chrome.runtime.sendMessage({ type: 'nsfyt:blocked' }).catch(() => {});
    } catch {
      // Контекст расширения перезагружен — счётчик не важнее самой блокировки.
    }
  }

  window.addEventListener('nsfyt-blocked', reportBlocked);

  // ------------------------------------------------- слой 2: перехват клика

  /**
   * Ищем ссылку на Short в цепочке события. composedPath нужен потому,
   * что новые компоненты YouTube живут в shadow DOM и обычный closest()
   * не проходит сквозь границу тени.
   */
  function shortsIdFromEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    for (const node of path) {
      if (node instanceof HTMLAnchorElement) {
        const id = videoIdFromHref(node.getAttribute('href'));
        if (id) return id;
      }
    }
    const target = event.target;
    if (target && typeof target.closest === 'function') {
      const anchor = target.closest(SHORTS_LINK);
      if (anchor) return videoIdFromHref(anchor.getAttribute('href'));
    }
    return null;
  }

  // Слушаем на window в фазе перехвата — это самая ранняя точка, раньше
  // делегированного обработчика Polymer. Переписать href недостаточно:
  // Polymer берёт цель перехода из привязанного объекта data, а не из атрибута.
  window.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    // Средний клик и клик с модификатором открывают новую вкладку —
    // там сработает declarativeNetRequest, вмешиваться не нужно.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const id = shortsIdFromEvent(event);
    if (!id) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    reportBlocked();
    lastRedirectAt = Date.now();
    // assign, а не replace: запись ленты остаётся в истории,
    // поэтому «назад» возвращает в неё с одного нажатия.
    location.assign(watchUrl(id));
  }, true);

  // -------------------------------------------- слой 3: наблюдатель за URL

  function enforceCurrentUrl() {
    const id = videoIdFromPath(location.pathname);
    if (!id) return;

    // Защита от петли, если редирект по какой-то причине вернёт нас обратно.
    const now = Date.now();
    if (now - lastRedirectAt < REDIRECT_COOLDOWN_MS) return;
    lastRedirectAt = now;

    reportBlocked();
    location.replace(watchUrl(id));
  }

  document.addEventListener('yt-navigate-finish', enforceCurrentUrl);
  window.addEventListener('popstate', enforceCurrentUrl);
  enforceCurrentUrl();

  // ------------------------------------------------ скрытие: JS-подстраховка

  /**
   * Проход не прячет элементы сразу, а собирает множество — и лишь потом
   * приводит DOM к нему. Так скрытие обратимо, и это принципиально: YouTube
   * переиспользует узлы ленты при виртуальном скролле, перепривязывая к ним
   * новые данные. Узел, помеченный как Short, позже получает обычное видео —
   * и без снятия класса остался бы невидимым навсегда.
   */
  function collect(target, element) {
    if (element && !NEVER_HIDE.has(element.tagName.toLowerCase())) {
      target.add(element);
    }
  }

  function applyHidden(target) {
    for (const element of document.querySelectorAll('.' + HIDDEN)) {
      if (!target.has(element)) element.classList.remove(HIDDEN);
    }
    for (const element of target) element.classList.add(HIDDEN);
  }

  /**
   * Ищем контейнер ссылки. Сначала по известным именам, затем — по форме имени
   * компонента. Второй проход и есть защита от переименований: YouTube меняет
   * ytd-*-renderer на *-view-model, но структура остаётся прежней.
   */
  function containerFor(anchor) {
    // Запоминаем совпадение и продолжаем подъём: нужна внешняя обёртка, а не
    // внутренняя. Вернув первую попавшуюся, можно скрыть одно превью и оставить
    // висеть заголовок с названием канала. Выше уровня карточки не уйдём —
    // подъём упирается в полку или каркас страницы.
    let best = null;
    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
      const tag = node.tagName.toLowerCase();
      if (NEVER_HIDE.has(tag) || SHELF_TAGS.has(tag)) break;
      if (node.matches(CONTAINER_SELECTOR)) return node;
      if (GENERIC_CONTAINER.test(tag)) best = node;
    }
    return best;
  }

  /** Полка считается шортсовой, если в ней только Shorts и ни одного обычного видео. */
  function isShortsShelf(shelf) {
    if (shelf.hasAttribute('is-shorts')) return true;

    const tag = shelf.tagName.toLowerCase();
    if (tag === 'ytd-reel-shelf-renderer' || tag === 'ytm-reel-shelf-renderer') {
      return true;
    }

    const hasShorts = [...shelf.querySelectorAll(SHORTS_LINK)]
      .some((a) => shortsLinkKind(a.getAttribute('href')) === 'video');
    return hasShorts && shelf.querySelectorAll('a[href*="/watch"]').length === 0;
  }

  function collectShelves(target, root) {
    for (const shelf of root.querySelectorAll(SHELF_SELECTOR)) {
      if (isShortsShelf(shelf)) collect(target, shelf);
    }
  }

  function collectLinkedElements(target, root) {
    for (const anchor of root.querySelectorAll(SHORTS_LINK)) {
      if (!shortsLinkKind(anchor.getAttribute('href')) || anchor.closest(USER_TEXT)) continue;
      // Если знакомого контейнера нет — прячем хотя бы саму ссылку.
      const container = containerFor(anchor);
      const containsVideo = container?.querySelector('a[href^="/watch?"], a[href^="https://www.youtube.com/watch?"], a[href^="https://m.youtube.com/watch?"]');
      collect(target, containsVideo ? anchor : container || anchor);
    }
  }

  /** Есть ли у элемента ссылка, ведущая куда-то помимо Shorts. */
  function leadsElsewhere(element) {
    for (const anchor of element.querySelectorAll('a[href]')) {
      if (!shortsLinkKind(anchor.getAttribute('href'))) return true;
    }
    return false;
  }

  /**
   * Последнее средство: часть вкладок и чипов хранит переход в свойствах
   * компонента, а не в href, и опознать их можно только по подписи.
   *
   * Применяется исключительно к пунктам без собственного адреса назначения.
   * Иначе под правило попадают каналы из подписок — они рендерятся тем же
   * ytd-guide-entry-renderer, и канал с названием «Shorts» исчезал бы из
   * бокового меню, не имея к разделу Shorts никакого отношения.
   */
  function collectByLabel(target, root) {
    const selector = 'yt-tab-shape, tp-yt-paper-tab, yt-chip-cloud-chip-renderer, ' +
      'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer';

    for (const element of root.querySelectorAll(selector)) {
      const label = (element.getAttribute('tab-title') || element.textContent || '')
        .trim()
        .toLowerCase();
      if (SHORTS_LABELS.has(label) && !leadsElsewhere(element)) collect(target, element);
    }
  }

  let scanScheduled = false;

  // Тротлинг через setTimeout, а не requestAnimationFrame: rAF не вызывается,
  // пока вкладка не отрисовывается, и в фоновой вкладке скрытие не срабатывало
  // бы вовсе. Задержка заодно склеивает пачки мутаций от бесконечной ленты.
  const SCAN_DELAY_MS = 200;

  function scan() {
    const target = new Set();
    // Порядок важен: сначала полка целиком, иначе от неё останется
    // пустой заголовок после скрытия отдельных карточек.
    collectShelves(target, document);
    collectLinkedElements(target, document);
    collectByLabel(target, document);
    applyHidden(target);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, SCAN_DELAY_MS);
  }

  // За href следим отдельно: при переиспользовании узла ленты YouTube меняет
  // именно его, и без этого подменённая карточка осталась бы скрытой до
  // ближайшей перестройки DOM. Фильтр по одному атрибуту не даёт наблюдателю
  // захлебнуться постоянной вознёй YouTube с остальными атрибутами.
  new MutationObserver(scheduleScan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  });

  document.addEventListener('yt-navigate-finish', scheduleScan);
  document.addEventListener('DOMContentLoaded', scheduleScan);
  scheduleScan();
})();
