const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Listen to console to see errors
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err));
  
  await page.goto('https://skuf-net.ru', { waitUntil: 'networkidle' });
  
  // Login
  await page.fill('#login-username', 'test_bot');
  await page.fill('#login-password', '123456');
  await page.click('#login-form button[type="submit"]');
  
  // Wait for sidebar
  await page.waitForSelector('.sidebar-item', { state: 'visible', timeout: 15000 });
  console.log('Sidebar item is visible');
  
  // Click first item
  await page.click('.sidebar-item');
  console.log('Clicked sidebar item');
  
  // Wait a bit
  await page.waitForTimeout(2000);
  
  const hasClass = await page.evaluate(() => document.querySelector('.chat-layout')?.classList.contains('chat-open'));
  console.log('Has chat-open class:', hasClass);
  
  await browser.close();
})();
