/* Runs in <head> before paint: marks JS as available and applies a saved theme so there is no flash. */
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the OS setting */ }
})();
