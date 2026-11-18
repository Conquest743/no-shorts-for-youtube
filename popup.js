'use strict';

/**
 * День по местному времени. Копия функции из background.js — service worker
 * и попап не делят модуль, а считать день обязаны одинаково, иначе попап
 * сравнит с другим календарём и покажет ноль.
 */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

chrome.storage.local.get('stats').then(({ stats }) => {
  const fresh = stats && stats.day === today();

  document.getElementById('today').textContent = fresh ? stats.today : 0;
  document.getElementById('total').textContent = (stats && stats.total) || 0;
});
