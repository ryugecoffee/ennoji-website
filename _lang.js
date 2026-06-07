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
