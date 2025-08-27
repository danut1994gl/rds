const axios = require('axios');
const { logger } = require('./logger');

const BASE_URL = 'http://localhost:3000';

const runTests = async () => {
  console.log('=== Test Suite pentru RDS M3U8 Service ===\n');

  const tests = [
    {
      name: 'Health Check',
      url: `${BASE_URL}/health`,
      expected: (data) => data.status === 'ok'
    },
    {
      name: 'Lista Canale',
      url: `${BASE_URL}/channels`, 
      expected: (data) => data.success && Array.isArray(data.channels)
    },
    {
      name: 'Statistici',
      url: `${BASE_URL}/api/stats`,
      expected: (data) => data.pool && data.server
    },
    {
      name: 'Canal Valid - Romania Antena 1 HD',
      url: `${BASE_URL}/romaniaantena1hd`,
      expected: (data) => data.channel === 'romaniaantena1hd',
      timeout: 60000 // 60 secunde pentru extragerea m3u8
    },
    {
      name: 'Canal Invalid',
      url: `${BASE_URL}/canalexistent`,
      expected: (data) => !data.success,
      expectError: true
    }
  ];

  let passed = 0;
  let total = tests.length;

  for (const test of tests) {
    try {
      console.log(`🧪 Testing: ${test.name}...`);
      
      const startTime = Date.now();
      const response = await axios.get(test.url, {
        timeout: test.timeout || 10000,
        validateStatus: () => true // acceptăm și statusuri de eroare
      });
      const duration = Date.now() - startTime;

      const data = response.data;
      
      console.log(`   Status: ${response.status}`);
      console.log(`   Duration: ${duration}ms`);
      
      if (test.expectError) {
        if (response.status >= 400) {
          console.log(`   ✅ ${test.name} - PASS (expected error)`);
          passed++;
        } else {
          console.log(`   ❌ ${test.name} - FAIL (expected error but got success)`);
        }
      } else if (response.status === 200 && test.expected(data)) {
        console.log(`   ✅ ${test.name} - PASS`);
        if (test.name.includes('Canal Valid') && data.m3u8) {
          console.log(`   📺 M3U8 URL: ${data.m3u8}`);
        }
        passed++;
      } else {
        console.log(`   ❌ ${test.name} - FAIL`);
        console.log(`   Response:`, JSON.stringify(data, null, 2));
      }

    } catch (error) {
      if (test.expectError) {
        console.log(`   ✅ ${test.name} - PASS (expected error)`);
        passed++;
      } else {
        console.log(`   ❌ ${test.name} - ERROR: ${error.message}`);
      }
    }
    
    console.log('');
  }

  console.log(`=== Rezultate: ${passed}/${total} teste trecute ===`);
  
  if (passed === total) {
    console.log('🎉 Toate testele au trecut!');
    process.exit(0);
  } else {
    console.log('❌ Unele teste au eșuat!');
    process.exit(1);
  }
};

// Performance test
const performanceTest = async () => {
  console.log('\n=== Test de Performanță ===');
  
  const concurrent = 3;
  const channel = 'romaniaantena1hd';
  
  console.log(`Testing ${concurrent} cereri simultane pentru ${channel}...`);
  
  const startTime = Date.now();
  const promises = Array(concurrent).fill().map((_, i) => 
    axios.get(`${BASE_URL}/${channel}`, { timeout: 60000 })
      .then(response => ({ index: i, success: true, data: response.data }))
      .catch(error => ({ index: i, success: false, error: error.message }))
  );
  
  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  const successful = results.filter(r => r.success).length;
  
  console.log(`Rezultate după ${duration}ms:`);
  console.log(`  Succes: ${successful}/${concurrent}`);
  console.log(`  Timp mediu per cerere: ${Math.round(duration/concurrent)}ms`);
  
  results.forEach(result => {
    if (result.success) {
      console.log(`  ✅ Request ${result.index}: ${result.data.success ? 'SUCCESS' : 'FAILED'}`);
    } else {
      console.log(`  ❌ Request ${result.index}: ${result.error}`);
    }
  });
};

// Rulăm testele
const main = async () => {
  try {
    await runTests();
    await performanceTest();
  } catch (error) {
    console.error('Test suite error:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  main();
}

module.exports = { runTests, performanceTest };