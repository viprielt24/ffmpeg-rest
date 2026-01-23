"""Patch InfiniteTalk to work without xfuser (single-GPU mode)."""
import re

mock_functions = '''# Mock xfuser functions for single-GPU inference (xfuser requires PyTorch 2.5+)
def get_sequence_parallel_rank():
    return 0
def get_sequence_parallel_world_size():
    return 1
def get_sp_group():
    return None
'''

# Patch files that have xfuser imports
files_to_patch = [
    '/workspace/InfiniteTalk/wan/utils/multitalk_utils.py',
    '/workspace/InfiniteTalk/wan/modules/attention.py',
]

for path in files_to_patch:
    try:
        with open(path, 'r') as f:
            lines = f.readlines()

        # Find and remove all xfuser import lines (multi-line import)
        new_lines = []
        in_xfuser_import = False
        xfuser_removed = False

        for line in lines:
            if 'from xfuser' in line:
                in_xfuser_import = True
                # Add mock functions instead of the first xfuser import line
                new_lines.append(mock_functions)
                xfuser_removed = True
                continue

            if in_xfuser_import:
                # Check if this line ends the import (has closing parenthesis)
                if ')' in line:
                    in_xfuser_import = False
                continue  # Skip all lines in the xfuser import block

            new_lines.append(line)

        with open(path, 'w') as f:
            f.writelines(new_lines)

        if xfuser_removed:
            print(f'Patched {path}: removed xfuser imports and added mocks')
        else:
            print(f'{path}: no xfuser imports found')
    except FileNotFoundError:
        print(f'{path}: file not found, skipping')

# Fix Python 3.11 compatibility - ArgSpec was removed
# Replace 'from inspect import ArgSpec' with FullArgSpec alias
multitalk_path = '/workspace/InfiniteTalk/wan/multitalk.py'
try:
    with open(multitalk_path, 'r') as f:
        lines = f.readlines()

    new_lines = []
    argspec_fixed = False
    for line in lines:
        if 'from inspect import ArgSpec' in line:
            new_lines.append('from inspect import FullArgSpec as ArgSpec\n')
            argspec_fixed = True
        else:
            new_lines.append(line)

    with open(multitalk_path, 'w') as f:
        f.writelines(new_lines)

    if argspec_fixed:
        print(f'Patched {multitalk_path}: fixed ArgSpec for Python 3.11')
    else:
        print(f'{multitalk_path}: ArgSpec import not found')
except FileNotFoundError:
    print(f'{multitalk_path}: file not found, skipping')

# Fix wav2vec2.py to use eager attention (SDPA doesn't support output_attentions)
wav2vec_path = '/workspace/InfiniteTalk/src/audio_analysis/wav2vec2.py'
try:
    with open(wav2vec_path, 'r') as f:
        content = f.read()

    if 'self.config.output_attentions = True' in content:
        content = content.replace(
            'self.config.output_attentions = True',
            '# self.config.output_attentions = True  # Disabled - handled by eager attention'
        )
        with open(wav2vec_path, 'w') as f:
            f.write(content)
        print(f'Patched {wav2vec_path}: disabled output_attentions setting')
    else:
        print(f'{wav2vec_path}: output_attentions line not found')
except FileNotFoundError:
    print(f'{wav2vec_path}: file not found, skipping')

# Patch model loading in generate_infinitetalk.py to use eager attention
gen_path = '/workspace/InfiniteTalk/generate_infinitetalk.py'
try:
    with open(gen_path, 'r') as f:
        content = f.read()

    if 'Wav2Vec2Model.from_pretrained(wav2vec, local_files_only=True)' in content and "attn_implementation='eager'" not in content:
        content = content.replace(
            'Wav2Vec2Model.from_pretrained(wav2vec, local_files_only=True)',
            "Wav2Vec2Model.from_pretrained(wav2vec, local_files_only=True, attn_implementation='eager')"
        )
        with open(gen_path, 'w') as f:
            f.write(content)
        print(f'Patched {gen_path}: added eager attention to Wav2Vec2Model')
    else:
        print(f'{gen_path}: Wav2Vec2Model already patched or not found')
except FileNotFoundError:
    print(f'{gen_path}: file not found, skipping')

print('All patches complete!')
