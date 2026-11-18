/**
 * No Shorts for YouTube — перехват SPA-навигации в MAIN world.
 *
 * Работает в контексте самой страницы (не в isolated world), потому что
 * подменить history.pushState можно только там, где его вызывает YouTube.
 *
 * Это самая ранняя точка, где видно переход в Shorts: событие
 * yt-navigate-finish приходит заметно позже, а service worker — ещё позже.
 * Здесь важен именно location.replace: он затирает только что добавленную
 * запись /shorts/ID, поэтому «назад» возвращает в ленту с одного нажатия.
 */
(() => {
  'use strict';

  const SHORTS_PATH = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/;
  const GUARD_KEY = 'nsfyt:last-redirect';
  const GUARD_WINDOW_MS = 3000;

  /**
   * Защита от петли: если бы /watch когда-нибудь отдал редирект обратно на
   * /shorts, вкладка перезагружалась бы бесконечно. Замыкание тут не поможет —
   * location.replace перезагружает страницу и обнуляет его, поэтому отметка
   * живёт в sessionStorage, который переживает перезагрузку вкладки.
   *
   * Блокируем повтор только для того же самого id: иначе сломался бы обычный
   * сценарий «открыл один Short, через секунду другой».
   */
  function looping(id) {
    try {
      const [lastId, lastAt] = (sessionStorage.getItem(GUARD_KEY) || ':0').split(':');
      if (lastId === id && Date.now() - Number(lastAt) < GUARD_WINDOW_MS) return true;
      sessionStorage.setItem(GUARD_KEY, `${id}:${Date.now()}`);
    } catch {
      // sessionStorage недоступен — работаем без защиты, падать здесь нельзя.
    }
    return false;
  }

  function redirectIfShorts() {
    const match = SHORTS_PATH.exec(location.pathname);
    if (!match) return;
    if (looping(match[1])) return;

    window.dispatchEvent(new CustomEvent('nsfyt-blocked'));
    location.replace(`${location.origin}/watch?v=${match[1]}`);
  }

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      // Сначала отдаём ход YouTube, потом правим адрес: если перехватить до
      // вызова, replace затрёт запись ленты, и «назад» уведёт мимо неё.
      redirectIfShorts();
      return result;
    };
  }
})();
