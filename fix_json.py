import json

# Load your current file
with open('real_accounts.json', 'r', encoding='utf-8') as f:
    accounts = json.load(f)

# Add missing fields
for acc in accounts:
    acc['followers'] = 0  # placeholder (you can't know real followers without API)
    acc['link'] = f"https://tiktok.com/@{acc['username']}"

# Save fixed version
with open('real_accounts_fixed.json', 'w', encoding='utf-8') as f:
    json.dump(accounts, f, indent=2)

print(f"✅ Fixed {len(accounts)} accounts with link and followers fields")