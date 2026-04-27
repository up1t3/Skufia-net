const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Pass errors from the browser to node
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    
    console.log('Navigating to app...');
    // Login
    await page.goto('http://127.0.0.1:8000/messenger.html');
    
    // Wait for auth to be ready
    await new Promise(r => setTimeout(r, 2000));
    
    // Evaluate in context
    await page.evaluate(async () => {
        console.log("Setting token...");
        window.localStorage.setItem('skuf_token', 'mock_token');
        window.state = window.state || {};
        window.state.user = { id: 1, username: 'testuser', token: 'mock_token' };
        window.state.chat = window.state.chat || {};
        window.state.chat.currentRoomId = 1;
        window.state.chat.currentRoomType = 'private';
        
        window.CryptoManager = {
            encryptMessage: async (k, c) => ({content: c, iv: 'mock'})
        };
        
        window.getOrEstablishSessionKey = async () => ({keys: {1: 'mock'}, active_version: 1});
        
        // Mock apiRequest
        window.apiRequest = async (endpoint, method) => {
            console.log('Mock apiRequest called:', endpoint, method);
            return { id: 12345, status: 'mock' };
        };
    });
    
    console.log('Typing message...');
    await page.type('#chat-input', 'Hello world testing');
    
    const inputVal = await page.$eval('#chat-input', el => el.value);
    console.log('Input value before click:', inputVal);
    
    console.log('Clicking send button...');
    await page.click('#send-chat-btn');
    
    // Wait a bit
    await new Promise(r => setTimeout(r, 1000));
    
    const inputValAfter = await page.$eval('#chat-input', el => el.value);
    console.log('Input value after click:', inputValAfter);
    
    await browser.close();
})();
