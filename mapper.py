import re

def process(content):
    def repl(m):
        classesStr = m.group(1)
        classes = set(classesStr.split())
        
        if 'bg-white' in classes and 'dark:bg-gray-800' not in classes and 'dark:bg-gray-900' not in classes and 'w-24' not in classes and 'w-14' not in classes:
            classes.add('dark:bg-gray-800')
            classes.add('transition-colors')
            
        if 'bg-gray-50' in classes and 'dark:bg-gray-900' not in classes:
            classes.add('dark:bg-gray-900')
            
        if 'border-gray-100' in classes and 'dark:border-gray-800' not in classes:
            classes.add('dark:border-gray-800')
            
        if 'border-gray-200' in classes and 'dark:border-gray-700' not in classes:
            classes.add('dark:border-gray-700')
            
        if 'text-gray-900' in classes and 'dark:text-white' not in classes:
            classes.add('dark:text-white')
            
        if 'text-gray-700' in classes and 'dark:text-gray-200' not in classes:
            classes.add('dark:text-gray-200')
            
        if 'text-gray-600' in classes and 'dark:text-gray-300' not in classes:
            classes.add('dark:text-gray-300')
            
        if 'text-gray-500' in classes and 'dark:text-gray-400' not in classes:
            classes.add('dark:text-gray-400')
            
        if 'hover:bg-gray-50' in classes:
            classes.add('dark:hover:bg-gray-800')
            
        if 'bg-gray-200/60' in classes:
            classes.add('dark:bg-gray-800/80')
            
        return 'class="' + ' '.join(classes) + '"'

    return re.sub(r'class="([^"]+)"', repl, content)

with open('public/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

new_text = process(text)

with open('public/index.html', 'w', encoding='utf-8') as f:
    f.write(new_text)

print("Done python mapping.")
