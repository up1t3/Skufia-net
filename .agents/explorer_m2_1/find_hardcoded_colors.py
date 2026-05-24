import re
import os

files_to_check = [
    'frontend/style.css',
    'frontend/chat.css',
    'frontend/style-modal.css'
]

hex_pattern = re.compile(r'#(?:[0-9a-fA-F]{3,4}){1,2}\b')
rgb_pattern = re.compile(r'rgba?\([^)]+\)')

output_lines = []

def parse_css(file_path, file_rel_path):
    output_lines.append(f"\n========================================\nAnalyzing file: {file_rel_path}\n========================================\n")
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    in_theme_block = False
    current_selector = ""
    theme_selector_regex = re.compile(r'^(:root|\[data-theme=)')
    
    bracket_level = 0
    
    for i, line in enumerate(lines):
        line_num = i + 1
        clean_line = line.strip()
        
        for char in clean_line:
            if char == '{':
                if bracket_level == 0:
                    current_selector = clean_line.split('{')[0].strip()
                    if theme_selector_regex.search(current_selector):
                        in_theme_block = True
                    else:
                        in_theme_block = False
                bracket_level += 1
            elif char == '}':
                bracket_level -= 1
                if bracket_level == 0:
                    in_theme_block = False
                    current_selector = ""
        
        if bracket_level > 0 and not in_theme_block:
            hex_matches = hex_pattern.findall(clean_line)
            rgb_matches = rgb_pattern.findall(clean_line)
            
            if hex_matches or rgb_matches:
                matches = hex_matches + rgb_matches
                output_lines.append(f"Line {line_num:4d} | Selector: {current_selector} | Matches: {matches} | Line: {clean_line}\n")

for f_path in files_to_check:
    full_path = os.path.join(r'e:\Skufia-net', f_path)
    parse_css(full_path, f_path)

report_path = r'e:\Skufia-net\.agents\explorer_m2_1\colors_report.txt'
with open(report_path, 'w', encoding='utf-8') as f:
    f.writelines(output_lines)
print(f"Report written to {report_path}")
