UPDATE "Merchant"
SET "platformFeeBps" = 300
WHERE "id" = 'cmt4nvbkv00020ktarra24kvi'
   OR lower("slug") IN ('rgvprime', 'rgvprime-llc')
   OR lower("businessName") IN ('rgvprime', 'rgvprime llc');
