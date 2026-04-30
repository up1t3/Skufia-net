const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('response', resp => {
    if (resp.status() === 401) {
        console.log('401 UNAUTHORIZED ON:', resp.url());
    }
  });
  
  await page.goto('https://skuf-net.ru/messenger.html', { waitUntil: 'networkidle' });

  await page.click('#toggle-to-register');
  await page.fill('#reg-username', 'test_401_' + Date.now());
  await page.fill('#reg-password', '123456');
  await page.fill('#reg-email', 'test401_' + Date.now() + '@example.com');
  await page.check('#reg-pd-consent');
  
  await page.click('#register-form button[type="submit"]');
  await page.waitForTimeout(2000);
  
  await page.click('#login-form button[type="submit"]');
  await page.waitForTimeout(5000);
  
  await browser.close();
})();
