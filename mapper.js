const fs = require('fs');

const path = 'public/index.html';
let content = fs.readFileSync(path, 'utf-8');

const regex = /class="([^"]+)"/g;

content = content.replace(regex, (match, classesStr) => {
    let classes = classesStr.split(/\s+/);
    let newClasses = new Set(classes);

    const has = (cls) => newClasses.has(cls);
    const add = (cls) => newClasses.add(cls);

    if (has('bg-white') && !has('dark:bg-gray-800') && !has('dark:bg-gray-900') && !has('w-14') && !has('w-24')) {
        add('dark:bg-gray-800');
        add('transition-colors');
    }
    
    if (has('bg-gray-50') && !has('dark:bg-gray-900')) {
        add('dark:bg-gray-900');
    }

    if (has('border-gray-100') && !has('dark:border-gray-800')) {
        add('dark:border-gray-800');
    }

    if (has('border-gray-200') && !has('dark:border-gray-700')) {
        add('dark:border-gray-700');
    }

    if (has('text-gray-900') && !has('dark:text-white')) {
        add('dark:text-white');
    }

    if (has('text-gray-700') && !has('dark:text-gray-200')) {
        add('dark:text-gray-200');
    }

    if (has('text-gray-600') && !has('dark:text-gray-300')) {
        add('dark:text-gray-300');
    }

    if (has('text-gray-500') && !has('dark:text-gray-400')) {
        add('dark:text-gray-400');
    }

    if (has('text-gray-400') && !has('dark:text-gray-500')) {
        add('dark:text-gray-500');
    }

    if (has('hover:bg-gray-50')) {
        add('dark:hover:bg-gray-800');
    }

    if (has('bg-gray-200/60')) {
        add('dark:bg-gray-800/80');
    }

    return `class="${Array.from(newClasses).join(' ')}"`;
});

fs.writeFileSync(path, content, 'utf-8');
console.log('Successfully injected Dark Mode classes into index.html');
