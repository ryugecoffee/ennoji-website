function setLang(lang) {
  document.querySelectorAll('.lang-switcher button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + lang).classList.add('active');
  document.querySelectorAll('[data-lang]').forEach(el => {
    el.classList.toggle('active', el.dataset.lang === lang);
  });
  document.querySelectorAll('[data-ja]').forEach(el => {
    el.textContent = el.dataset[lang] || el.dataset.ja;
  });
  localStorage.setItem('ennoji-lang', lang);
}
const saved = localStorage.getItem('ennoji-lang') || 'ja';
setLang(saved);

// ハンバーガーメニュー
(function() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', function() {
    const open = links.classList.toggle('open');
    toggle.classList.toggle('open', open);
  });
  // リンククリックで閉じる
  links.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      links.classList.remove('open');
      toggle.classList.remove('open');
    });
  });
})();
