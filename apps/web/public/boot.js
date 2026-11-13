// apps/web/public/boot.js (launch screen, Felix 26.10, docs/design/2026-10-26-splash.md), loaded in index.html <head> as
// <script src="/boot.js"></script>: a same-origin classic script, allowed by the CSP (script-src 'self'), runs before
// the first paint. It pins the colour theme and the motion level on <html> so the launch screen and the page start in
// the right colours: the chosen theme (localStorage bunprise.theme), else Telegram's scheme (sessionStorage
// bunprise.tgScheme, or on the first launch the bg_color of tgWebAppThemeParams in the URL fragment, read only), else
// nothing (= the system decides). Motion: the device setting (localStorage bunprise.reduceMotion) "reduced" / "off";
// the system's reduced motion is CSS. Mirrors lib/themeBoot.ts pinnedTheme(), lib/telegram/detect.ts schemeOf() and
// motion/level.ts parseMotionPrefs(); main.tsx sets the same attributes again a moment later.
// Since 27.10 it also links the home-screen icon chosen on this device (Einstellungen → App-Symbol, docs/handoffs/2026-10-27-app-icons.md).
// packages/mascot/demo/splash/boot.js is the gallery's identical copy (apps/web/src/lib/splash.test.ts compares them).
(function () {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('bunprise.theme') || sessionStorage.getItem('bunprise.tgScheme');
    var tg = /[#&]tgWebAppThemeParams=([^&]*)/.exec(location.hash);
    if (!theme && tg) {
      var hex = /"bg_color":\s*"#([0-9a-f]{6})"/i.exec(decodeURIComponent(tg[1]));
      if (hex) {
        var n = parseInt(hex[1], 16);
        theme = (n >> 16) + ((n >> 8) & 255) + (n & 255) < 384 ? 'dark' : 'light';
      }
    }
    if (/^(light|dark|navy|ocean|black)$/.test(theme || '')) root.setAttribute('data-theme', theme);
    // "Schwarz" (27.10, docs/handoffs/2026-10-27-black-theme.md): the browser bar / status bar starts black too
    // (lib/theme.ts THEME_COLORS.black pins the same a moment later)
    if (theme === 'black') {
      var metas = document.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', '#000000');
    }
    var motion = localStorage.getItem('bunprise.reduceMotion') || '';
    var level = motion === 'reduce' ? 'reduced' : (/"level":\s*"(full|reduced|off)"/.exec(motion) || [])[1];
    if (level === 'reduced') root.setAttribute('data-motion', 'reduce');
    if (level === 'off') root.setAttribute('data-motion', 'off');
    // The home-screen icon chosen on this device (Einstellungen → App-Symbol; the same list as
    // features/account/appIconVariants.ts): its manifest, Apple touch icon and tab icon replace the default links, which
    // come after this script in <head> — so they are swapped once the document is parsed. The phone reads them only
    // when Bunprise is added to the home screen; anything unknown keeps the default icon.
    var icon = localStorage.getItem('bunprise-appIcon');
    if (/^(dark|night|ocean|mono|tapsi|birthday|easter|summer|autumn|halloween|christmas)$/.test(icon || '')) {
      document.addEventListener('DOMContentLoaded', function () {
        var files = { manifest: 'manifest.webmanifest', 'apple-touch-icon': 'apple-touch-icon.png', icon: 'icon.svg' };
        for (var rel in files) {
          var link = document.querySelector('link[rel="' + rel + '"]');
          if (link) link.setAttribute('href', '/icons/variants/' + icon + '/' + files[rel]);
        }
      }, { once: true });
    }
  } catch (e) {
    /* storage blocked: the system decides, as without this script */
  }
})();
