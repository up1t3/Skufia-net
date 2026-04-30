const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  await page.goto('https://skuf-net.ru/messenger.html');
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({path: 'messenger.png'});
  await browser.close();
})();
