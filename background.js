/**
 * No Shorts for YouTube — service worker.
 *
 * Последняя сеть безопасности: ловит переходы в Shorts, которые пропустили
 * и перехват клика, и history-hook.js. Срабатывает, например, если content-скрипт
 * не внедрился.
 * Здесь же живёт счётчик перехваченных переходов для попапа.
 */

const SHORTS_PATH = /^\/shorts\/([A-Za-z0-9_-]+)\/?$/;
const REDIRECT_COOLDOWN_MS = 1500;

/**
 * Фора для content-скрипта. Он уходит с Shorts через location.replace и не
 * оставляет записи в истории, а tabs.update такую запись создаёт — из-за неё
 * «назад» приходится нажимать дважды. Поэтому вмешиваемся, только если через
 * это время адрес всё ещё шортсовый, то есть больше никто не сработал.
 */
const FALLBACK_DELAY_MS = 1000;

/** tabId -> время последнего редиректа, защита от петли. */
const lastRedirectByTab = new Map();

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    if (!SHORTS_PATH.test(pathnameOf(details.url))) return;

    const now = Date.now();
    if (now - (lastRedirectByTab.get(details.tabId) || 0) < REDIRECT_COOLDOWN_MS) return;
    lastRedirectByTab.set(details.tabId, now);

    setTimeout(() => rescueTab(details.tabId), FALLBACK_DELAY_MS);
  },
  { url: ['www.youtube.com', 'm.youtube.com'].map((hostEquals) => ({
    hostEquals, schemes: ['https'], pathPrefix: '/shorts/'
  })) }
);

chrome.tabs.onRemoved.addListener((tabId) => lastRedirectByTab.delete(tabId));

function pathnameOf(rawUrl) {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return '';
  }
}

async function rescueTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }

  if (url.protocol !== 'https:' || !['www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return;

  const match = SHORTS_PATH.exec(url.pathname);
  if (!match) return; // Кто-то из слоёв выше уже увёл вкладку — не мешаем.

  const updated = await chrome.tabs.update(tabId, { url: `${url.origin}/watch?v=${match[1]}` }).catch(() => null);
  if (updated) bumpCounter();
}

// --------------------------------------------------------------- счётчик

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'nsfyt:blocked') bumpCounter();
});

// Редиректы declarativeNetRequest происходят до загрузки страницы, поэтому
// content-скрипт о них не знает. Это событие доступно распакованным
// расширениям — именно так расширение и устанавливается.
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(() => bumpCounter());
}

/**
 * День по местному времени, а не по UTC. toISOString() сбрасывал бы счётчик
 * «сегодня» в полночь по Гринвичу — например, в 3 часа ночи для UTC+3.
 * Та же функция продублирована в popup.js: service worker и попап не делят
 * модуль, и считать день они обязаны одинаково.
 */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

let pendingWrite = Promise.resolve();

function bumpCounter() {
  const day = today();
  pendingWrite = pendingWrite
    .then(() => saveCount(day))
    .catch((error) => console.warn('No Shorts for YouTube: не удалось сохранить счётчик', error));
}

async function saveCount(day) {
  const { stats } = await chrome.storage.local.get('stats');
  const next =
    stats && stats.day === day
      ? { ...stats }
      : { day, today: 0, total: (stats && stats.total) || 0 };

  next.today += 1;
  next.total += 1;
  await chrome.storage.local.set({ stats: next });
}
