# Railway Deployment Config

## Live URL
https://poly-shore-production.up.railway.app

## Project Token (use this for API calls)
741061f8-d308-41d3-856a-7d2b3d9711f2

## IDs
| Name | ID |
|---|---|
| Project | 940ddb65-7c6a-47d2-86d0-606c90dcd69b |
| Environment | cb01de75-2bf4-4f40-b529-dc2f224a3ce1 |
| POLY-SHORE Service | 34053d25-39a7-48d3-b041-a306b66ce5fe |
| MySQL Service | a94c78a5-d989-4c2f-b627-8260d808da93 |

## MySQL
- Internal (Railway only): `mysql://root:bMlpIzgTCaWLhtMFGLDTgypSiwqlksHt@mysql.railway.internal:3306/railway`
- External proxy: `mysql://root:bMlpIzgTCaWLhtMFGLDTgypSiwqlksHt@shortline.proxy.rlwy.net:41621/railway`

## Environment Variables (set on POLY-SHORE service)
| Variable | Value |
|---|---|
| DATABASE_URL | ${{MySQL.MYSQL_URL}} |
| NODE_ENV | production |
| LIVE_TRADING_ENABLED | false |
| KILLSWITCH_ARMED | false |
| DEEP_EDGE_MIN_SCORE | 0.7 |
| DEEP_EDGE_MIN_CONFIDENCE | 0.8 |
| OLLAMA_MODEL | llama3.1:8b |
| POLYMARKET_HOST | https://clob.polymarket.com |
| POLYMARKET_CHAIN_ID | 137 |
| KILLSWITCH_NOTIONAL_CAP_USD | 500 |
| KILLSWITCH_ORDERS_PER_MIN | 10 |
| KILLSWITCH_PER_MARKET_CAP_USD | 100 |
| KILLSWITCH_MAX_SPREAD_BPS | 500 |
| X_BEARER_TOKEN | (set — X/Twitter API) |

## To set/update any env var
```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer 741061f8-d308-41d3-856a-7d2b3d9711f2" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json; print(json.dumps({
    'query': 'mutation BulkUpsert(\$input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: \$input) }',
    'variables': {'input': {
      'projectId': '940ddb65-7c6a-47d2-86d0-606c90dcd69b',
      'environmentId': 'cb01de75-2bf4-4f40-b529-dc2f224a3ce1',
      'serviceId': '34053d25-39a7-48d3-b041-a306b66ce5fe',
      'variables': {'KEY': 'VALUE'}
    }}
  }))")"
```

## To redeploy
```bash
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer 741061f8-d308-41d3-856a-7d2b3d9711f2" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { serviceInstanceRedeploy(environmentId: \"cb01de75-2bf4-4f40-b529-dc2f224a3ce1\", serviceId: \"34053d25-39a7-48d3-b041-a306b66ce5fe\") }"}'
```
