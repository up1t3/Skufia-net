const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
        console.log('NAVIGATED TO:', frame.url());
    }
  });
  
  await page.goto('https://skuf-net.ru/messenger.html', { waitUntil: 'networkidle' });

  await page.click('#toggle-to-register');
  await page.fill('#reg-username', 'test_reload_' + Date.now());
  await page.fill('#reg-password', '123456');
  await page.fill('#reg-email', 'testrel_' + Date.now() + '@example.com');
  await page.check('#reg-pd-consent');
  
  await page.click('#register-form button[type="submit"]');
  await page.waitForTimeout(2000);
  
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(5000);
  
  await browser.close();
})();
