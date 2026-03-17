"""Index constituent lists.

Sources:
- Nikkei 225: https://indexes.nikkei.co.jp/en/nkave/index/component (~100 constituents)
- S&P 500: public knowledge (~100 by market cap)
- TOPIX: JPX (~50 by market cap)

These are approximate snapshot lists for v1.0.
In production, use official licensed data or import from CSV.
"""

# Nikkei 225 — ~100 constituents (price-weighted)
NIKKEI225_FULL = {
    "9983.T": "Fast Retailing", "8035.T": "Tokyo Electron", "6857.T": "Advantest",
    "9984.T": "SoftBank Group", "4063.T": "Shin-Etsu Chemical", "6762.T": "TDK",
    "6098.T": "Recruit Holdings", "4568.T": "Daiichi Sankyo", "6367.T": "Daikin Industries",
    "7203.T": "Toyota Motor", "6758.T": "Sony Group", "6861.T": "Keyence",
    "6501.T": "Hitachi", "7741.T": "HOYA", "6902.T": "Denso",
    "9433.T": "KDDI", "8306.T": "MUFG", "6645.T": "Omron",
    "4543.T": "Terumo", "6954.T": "Fanuc", "7267.T": "Honda Motor",
    "9432.T": "NTT", "4519.T": "Chugai Pharmaceutical", "6971.T": "Kyocera",
    "8766.T": "Tokio Marine", "6503.T": "Mitsubishi Electric", "2802.T": "Ajinomoto",
    "7974.T": "Nintendo", "3382.T": "Seven & i Holdings", "4911.T": "Shiseido",
    "6988.T": "Nitto Denko", "6146.T": "Disco Corp", "4704.T": "Trend Micro",
    "7751.T": "Canon", "8801.T": "Mitsui Fudosan", "4578.T": "Otsuka Holdings",
    "8015.T": "Toyota Tsusho", "9613.T": "NTT Data Group", "6479.T": "Minebea Mitsumi",
    "4507.T": "Shionogi", "6723.T": "Renesas Electronics", "8058.T": "Mitsubishi Corp",
    "6506.T": "Yaskawa Electric", "8031.T": "Mitsui & Co", "4523.T": "Eisai",
    "6752.T": "Panasonic", "7733.T": "Olympus", "4901.T": "Fujifilm Holdings",
    "6981.T": "Murata Manufacturing", "8001.T": "ITOCHU", "7832.T": "Bandai Namco",
    "8316.T": "SMFG", "6594.T": "Nidec", "9766.T": "Konami Group",
    "4661.T": "Oriental Land", "8830.T": "Sumitomo Realty", "4452.T": "Kao Corp",
    "5803.T": "Fujikura", "4755.T": "Rakuten Group", "9020.T": "JR East",
    "8591.T": "ORIX", "3659.T": "Nexon", "7269.T": "Suzuki Motor",
    "6301.T": "Komatsu", "4502.T": "Takeda Pharmaceutical", "2914.T": "Japan Tobacco",
    "7201.T": "Nissan Motor", "6702.T": "Fujitsu", "3407.T": "Asahi Kasei",
    "5108.T": "Bridgestone", "8802.T": "Mitsubishi Estate", "4503.T": "Astellas Pharma",
    "7912.T": "Dai Nippon Printing", "6504.T": "Fuji Electric", "4324.T": "Dentsu Group",
    "7211.T": "Mitsubishi Motors", "6326.T": "Kubota", "5713.T": "Sumitomo Metal Mining",
    "4151.T": "Kyowa Kirin", "9843.T": "Nitori Holdings", "7261.T": "Mazda Motor",
    "5401.T": "Nippon Steel", "7011.T": "Mitsubishi Heavy Industries",
    "8002.T": "Marubeni", "5711.T": "Mitsubishi Materials",
    "6674.T": "GS Yuasa", "7735.T": "Screen Holdings", "9531.T": "Tokyo Gas",
    "1928.T": "Sekisui House", "5020.T": "ENEOS Holdings",
    "9502.T": "Chubu Electric Power", "2503.T": "Kirin Holdings",
    "9021.T": "JR West", "8725.T": "MS&AD Insurance",
    "8604.T": "Nomura Holdings", "8309.T": "Mitsui Sumitomo Trust",
    "6753.T": "Sharp", "4689.T": "LY Corp", "2413.T": "M3",
    "6701.T": "NEC", "6103.T": "Okuma", "5802.T": "Sumitomo Electric",
    "3405.T": "Kureha", "1605.T": "INPEX", "9022.T": "JR Central",
}

# S&P 500 — top ~100 by market cap
SP500_FULL = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA", "AMZN": "Amazon",
    "GOOGL": "Alphabet A", "META": "Meta Platforms", "BRK-B": "Berkshire Hathaway",
    "LLY": "Eli Lilly", "AVGO": "Broadcom", "JPM": "JPMorgan Chase",
    "TSLA": "Tesla", "UNH": "UnitedHealth", "V": "Visa", "XOM": "Exxon Mobil",
    "MA": "Mastercard", "COST": "Costco", "PG": "Procter & Gamble",
    "JNJ": "Johnson & Johnson", "HD": "Home Depot", "ABBV": "AbbVie",
    "WMT": "Walmart", "NFLX": "Netflix", "CRM": "Salesforce",
    "BAC": "Bank of America", "ORCL": "Oracle", "CVX": "Chevron",
    "MRK": "Merck", "KO": "Coca-Cola", "AMD": "AMD", "PEP": "PepsiCo",
    "TMO": "Thermo Fisher", "LIN": "Linde", "CSCO": "Cisco",
    "ACN": "Accenture", "MCD": "McDonald's", "ABT": "Abbott Labs",
    "ADBE": "Adobe", "WFC": "Wells Fargo", "IBM": "IBM",
    "PM": "Philip Morris", "GE": "GE Aerospace", "NOW": "ServiceNow",
    "ISRG": "Intuitive Surgical", "CAT": "Caterpillar", "INTU": "Intuit",
    "QCOM": "Qualcomm", "TXN": "Texas Instruments", "VZ": "Verizon",
    "GS": "Goldman Sachs", "BKNG": "Booking Holdings", "AMGN": "Amgen",
    "SPGI": "S&P Global", "T": "AT&T", "AXP": "American Express",
    "PFE": "Pfizer", "BLK": "BlackRock", "MS": "Morgan Stanley",
    "RTX": "RTX Corp", "DHR": "Danaher", "LOW": "Lowe's",
    "NEE": "NextEra Energy", "HON": "Honeywell", "UNP": "Union Pacific",
    "UBER": "Uber", "ELV": "Elevance Health", "SYK": "Stryker",
    "TJX": "TJX Companies", "SBUX": "Starbucks", "ETN": "Eaton",
    "AMAT": "Applied Materials", "SCHW": "Charles Schwab", "BA": "Boeing",
    "BMY": "Bristol-Myers", "LMT": "Lockheed Martin", "LRCX": "Lam Research",
    "PLD": "Prologis", "MDLZ": "Mondelez", "CB": "Chubb",
    "DE": "Deere & Co", "GILD": "Gilead Sciences", "ADP": "ADP",
    "MMC": "Marsh McLennan", "VRTX": "Vertex Pharma", "CI": "Cigna",
    "MO": "Altria Group", "SO": "Southern Company", "DUK": "Duke Energy",
    "CL": "Colgate-Palmolive", "PYPL": "PayPal", "CME": "CME Group",
    "ICE": "Intercontinental Exchange", "INTC": "Intel", "REGN": "Regeneron",
    "KLAC": "KLA Corp", "ZTS": "Zoetis", "WM": "Waste Management",
    "SHW": "Sherwin-Williams", "SNPS": "Synopsys", "CDNS": "Cadence Design",
    "MCK": "McKesson", "EOG": "EOG Resources", "PH": "Parker Hannifin",
    "APD": "Air Products", "CMG": "Chipotle", "FDX": "FedEx",
    "ITW": "Illinois Tool Works", "GD": "General Dynamics",
}

# TOPIX — top ~50 by market cap
TOPIX_FULL = {
    "7203.T": "Toyota Motor", "8306.T": "MUFG", "6758.T": "Sony Group",
    "6861.T": "Keyence", "8035.T": "Tokyo Electron", "6501.T": "Hitachi",
    "7741.T": "HOYA", "9432.T": "NTT", "4063.T": "Shin-Etsu Chemical",
    "9984.T": "SoftBank Group", "6902.T": "Denso", "8766.T": "Tokio Marine",
    "9433.T": "KDDI", "4568.T": "Daiichi Sankyo", "6098.T": "Recruit Holdings",
    "8316.T": "SMFG", "8058.T": "Mitsubishi Corp", "6367.T": "Daikin Industries",
    "7267.T": "Honda Motor", "4519.T": "Chugai Pharmaceutical",
    "8001.T": "ITOCHU", "6503.T": "Mitsubishi Electric", "8031.T": "Mitsui & Co",
    "4502.T": "Takeda Pharmaceutical", "6857.T": "Advantest", "7974.T": "Nintendo",
    "6762.T": "TDK", "9983.T": "Fast Retailing", "3382.T": "Seven & i Holdings",
    "6954.T": "Fanuc", "6981.T": "Murata Manufacturing", "4901.T": "Fujifilm",
    "6594.T": "Nidec", "4661.T": "Oriental Land", "6301.T": "Komatsu",
    "8725.T": "MS&AD Insurance", "8591.T": "ORIX", "2914.T": "Japan Tobacco",
    "6702.T": "Fujitsu", "7011.T": "Mitsubishi Heavy Industries",
    "8604.T": "Nomura Holdings", "5401.T": "Nippon Steel",
    "9020.T": "JR East", "4452.T": "Kao Corp", "6988.T": "Nitto Denko",
    "8802.T": "Mitsubishi Estate", "8801.T": "Mitsui Fudosan",
    "2802.T": "Ajinomoto", "7751.T": "Canon", "6146.T": "Disco Corp",
}

CONSTITUENTS = {
    "nikkei225": NIKKEI225_FULL,
    "sp500": SP500_FULL,
    "topix": TOPIX_FULL,
}


def get_constituents(index_id: str) -> tuple[list[str], dict[str, str]]:
    """Get constituent tickers and names for an index."""
    data = CONSTITUENTS.get(index_id, {})
    tickers = list(data.keys())
    return tickers, data
