/**
 * Service Worker - キャッシュ全消去・自己削除版
 * 古いキャッシュをすべて削除してから自分自身を登録解除し、
 * ページを強制リロードして最新ファイルを取得させる。
 */

self.addEventListener('install', () => {
  // 即座にアクティベートに進む
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 1. すべてのキャッシュを削除
    caches.keys()
      .then(keys => Promise.all(keys.map(key => {
        console.log('[SW] キャッシュ削除:', key);
        return caches.delete(key);
      })))
      // 2. このService Worker自身を登録解除
      .then(() => self.registration.unregister())
      // 3. 全クライアント（タブ）を強制リロード
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        clients.forEach(client => client.navigate(client.url));
      })
  );
});
