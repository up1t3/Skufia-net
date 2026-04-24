const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://skuf-net.ru');
  
  await page.fill('#reg-login-username', 'test_bot_new');
  await page.fill('#reg-login-password', '123456');
  await page.click('button:has-text("ВОЙТИ")');
  
  await page.waitForSelector('.sidebar-item', { timeout: 15000 });
  console.log('Found sidebar items');
  
  await page.click('.sidebar-item');
  await page.waitForTimeout(1000);
  
  const layoutClasses = await page.evaluate(() => document.querySelector('.chat-layout')?.className);
  console.log('Classes:', layoutClasses);
  
  await browser.close();
})();
