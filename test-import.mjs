import('./server/index.js').catch(e => {
    process.stdout.write('ERROR: ' + e.message + '\n');
    process.stdout.write('CODE: ' + e.code + '\n');
    process.exit(1);
});
