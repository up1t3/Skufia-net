const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--ignore-certificate-errors', '--no-sandbox'] 
  });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.toString()));

  try {
    // 1. Go to page
    await page.goto('https://localhost:8444/messenger.html', { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
        const target = document.getElementById('auth-overlay');
        if (target) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((m) => {
                    if (m.attributeName === 'style') console.log('AUTH-OVERLAY STYLE CHANGED TO:', target.style.display);
                });
            });
            observer.observe(target, { attributes: true });
        }
    });
    
    // 2. Click "РЕГИСТРАЦИЯ"
    await page.evaluate(() => document.getElementById('toggle-to-register').click());
    
    // 3. Fill registration form
    const username = 'testuser_' + Date.now();
    await page.type('#reg-username', username);
    await page.type('#reg-email', username + '@test.com');
    await page.type('#reg-password', 'testpassword123');
    await page.evaluate(() => {
        document.getElementById('reg-pd-consent').checked = true;
        document.getElementById('reg-submit-btn').disabled = false;
    });
    
    // Submit registration
    await page.evaluate(() => document.getElementById('reg-submit-btn').click());
    
    // 4. Wait for it to switch to login form
    await page.waitForFunction(() => {
        return document.getElementById('login-form').style.display !== 'none';
    }, { timeout: 10000 });
    
    console.log("Registration successful, logging in...");
    
    // 5. Fill login form
    await page.type('#login-password', 'testpassword123');
    await page.type('#login-username', username); // add username
    
    // Submit login
    await page.evaluate(() => document.querySelector('#login-form button[type="submit"]').click());
    
    // Wait for token to be set
    await page.waitForFunction(() => window.state && window.state.user && window.state.user.token, { timeout: 10000 });
    
    // Wait an additional 2 seconds to allow bootSystem to finish and DOM to update
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Login successful, system booted.");
    
    // 7. Wait a bit for JS to run
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 8. Capture screenshot
    await page.screenshot({ path: 'login_real_result.png' });
    console.log("Screenshot saved to login_real_result.png");
    
    // 9. Output visibility of elements
    const html = await page.content();
    require('fs').writeFileSync('e:/AgentZero/page_content.html', html);
    console.log("HTML content saved to page_content.html");

    const visibility = await page.evaluate(() => {
        const auth = document.getElementById('auth-overlay');
        const container = document.querySelector('.app-container');
        const view = document.getElementById('view-messages');
        const main = document.querySelector('.main-interface');
        
        function getVis(el) {
            if (!el) return 'NULL';
            const st = window.getComputedStyle(el);
            return `${st.display} | ${st.visibility} | ${el.offsetHeight}px`;
        }
        
        return {
            'html-class': document.documentElement.className,
            'body-class': document.body.className,
            'auth-overlay': getVis(auth),
            'app-container': getVis(container),
            'main-interface': getVis(main),
            'view-messages': getVis(view)
        };
    });
    console.log("Visibility State:", visibility);
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    await browser.close();
  }
})();
