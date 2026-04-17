const fs = require('fs');
const http = require('http');

const putData = () => {
  return new Promise((resolve, reject) => {
    const db = require('./data/runtime-storage.json');
    const value = db['meal-plans'];
    const payloadStr = JSON.stringify({ value });
    
    const req = http.request({
      hostname: 'localhost',
      port: 5173,
      path: '/api/storage/meal-plans',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadStr)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    
    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
};

putData().then(console.log).catch(console.error);
