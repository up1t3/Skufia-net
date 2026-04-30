const fs = require('fs');
let code = fs.readFileSync('frontend/chat-sw.js', 'utf8');

// Find the problematic block:
//        }).then(() => {
//            return self.clients.claim();
//        
//    );
// And replace it with:
//        }).then(() => {
//            return self.clients.claim();
//        })
//    );

code = code.replace(/\}\)\.then\(\(\) => \{\s*return self\.clients\.claim\(\);\s*\);/g, '}).then(() => {\n            return self.clients.claim();\n        })\n    ;');

fs.writeFileSync('frontend/chat-sw.js', code);
console.log("Fixed chat-sw.js syntax");
