const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  
  await page.goto('https://skuf-net.ru/messenger.html', { waitUntil: 'networkidle' });

  await page.click('#toggle-to-register');
  await page.fill('#reg-username', 'test_bot_' + Date.now());
  await page.fill('#reg-password', '123456');
  await page.fill('#reg-email', 'test_' + Date.now() + '@example.com');
  await page.check('#reg-pd-consent');
  
  await Promise.all([
      page.click('#register-form button[type="submit"]'),
      page.waitForResponse(resp => resp.url().includes('/auth/register'))
  ]);
  
  await page.waitForTimeout(1000);
  
  console.log("Submitting login");
  await page.click('#login-form button[type="submit"]');
  
  const meRes = await page.waitForResponse(resp => resp.url().includes('/api/me'));
  console.log('/me status:', meRes.status());
  
  try {
      await page.waitForSelector('.sidebar-item', { state: 'visible', timeout: 8000 });
      console.log('Sidebar item is visible');
  } catch(e) {
      await page.screenshot({ path: 'test_error.png' });
      const html = await page.content();
      fs.writeFileSync('error_page.html', html);
      console.log('Failed, took screenshot and saved error_page.html');
  }
  
  await browser.close();
})();
