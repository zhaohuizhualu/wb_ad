import re
import time
from typing import Dict, Any, List

import requests
from loguru import logger


class EastMoneyFetcher:
    """东方财富财务数据抓取。

    支持 A 股（.SH/.SZ/.BJ）、港股（.HK）和美股（.O/.N 等）。
    不同市场的报表口径不同：
    - A 股：季报为累计口径，需要逐季相减；
    - 美股：接口直接提供单季度数据；
    - 港股：只有年报和中报，按半年度展示。
    """

    DATA_URL = "https://datacenter.eastmoney.com/securities/api/data/v1/get"
    A_SHARE_URL = "https://datacenter.eastmoney.com/securities/api/data/get"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://data.eastmoney.com/"
        })

    # ------------------------------------------------------------------
    # 通用工具
    # ------------------------------------------------------------------
    @staticmethod
    def _number(value):
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _currency_code(value, default="CNY"):
        if value is None:
            return default
        text = str(value).strip().upper()
        mapping = {
            "人民币": "CNY",
            "CNY": "CNY",
            "美元": "USD",
            "USD": "USD",
            "港元": "HKD",
            "港币": "HKD",
            "HKD": "HKD",
        }
        return mapping.get(text, default)

    @staticmethod
    def _quarter_name(quarter):
        return {
            1: "第一季度",
            2: "第二季度",
            3: "第三季度",
            4: "第四季度",
        }.get(quarter, "第%s季度" % quarter)

    def _request(self, report_name, stock_code, page_size=200):
        params = {
            "reportName": report_name,
            "columns": "ALL",
            "filter": '(SECUCODE="%s")' % stock_code,
            "pageNumber": 1,
            "pageSize": page_size,
            "sortColumns": "REPORT_DATE",
            "sortTypes": "-1",
            "source": "F10",
            "client": "PC",
        }
        try:
            resp = self.session.get(self.DATA_URL, params=params, timeout=30)
            if resp.status_code != 200:
                logger.warning("请求 {} 失败，状态码 {}", report_name, resp.status_code)
                return []
            data = resp.json()
            result = data.get("result")
            if isinstance(result, dict):
                return result.get("data") or []
            return []
        except Exception as e:
            logger.error("请求 {} 失败: {}", report_name, e)
            return []

    def _append_period(self, result, label, year, quarter, revenue, gross_profit,
                       net_profit, period_type):
        revenue_f = self._number(revenue)
        if revenue_f is None or revenue_f <= 0:
            return
        gross_profit_f = self._number(gross_profit)
        net_profit_f = self._number(net_profit)
        result["income_quarter"][label] = {
            "year": year,
            "quarter": quarter,
            "revenue": revenue_f,
            "gross_profit": gross_profit_f if gross_profit_f is not None else 0.0,
            "net_profit": net_profit_f if net_profit_f is not None else 0.0,
            "period_type": period_type,
        }

    @staticmethod
    def _diff(current, previous):
        current_f = EastMoneyFetcher._number(current)
        previous_f = EastMoneyFetcher._number(previous)
        if current_f is None or previous_f is None:
            return None
        return current_f - previous_f

    def _build_annual_cashflow(self, rows, capex_codes):
        cash_by_year = {}
        for row in rows:
            if row.get("REPORT_TYPE") != "年报":
                continue
            # 优先使用 STD_REPORT_DATE 提取财年（美股 FY 与自然年不同，
            # 如英伟达 FY2025 年报 REPORT_DATE=2026-01-25，但 STD_REPORT_DATE=2025-12-31）
            std_date = row.get("STD_REPORT_DATE") or ""
            report_date = row.get("REPORT_DATE") or ""
            date_str = std_date if len(std_date) >= 4 else report_date
            if len(date_str) < 4:
                continue
            year = int(date_str[:4])
            if year < 2015:
                continue
            entry = cash_by_year.get(year)
            if entry is None or report_date > entry["date"]:
                entry = {"date": report_date, "items": {}}
                cash_by_year[year] = entry
            if report_date == entry["date"]:
                entry["items"][row.get("STD_ITEM_CODE")] = self._number(row.get("AMOUNT"))

        cashflow = {}
        for year, entry in cash_by_year.items():
            items = entry["items"]
            operating = items.get("003999")
            capex = 0.0
            has_capex = False
            for code in capex_codes:
                value = items.get(code)
                if value is not None:
                    capex += abs(value)
                    has_capex = True
            cashflow[year] = {
                "经营活动产生的现金流量净额": operating,
                "购建固定资产、无形资产和其他长期资产支付的现金": capex if has_capex else None,
            }
        return cashflow

    # ------------------------------------------------------------------
    # 数据入口
    # ------------------------------------------------------------------
    def get_financial_data(self, stock_code: str, years: int = 10) -> Dict[str, Any]:
        code = stock_code.upper()
        if code.endswith((".SH", ".SZ", ".BJ")):
            return self._get_a_share_data(code)
        if code.endswith(".HK"):
            return self._get_hk_data(code)
        return self._get_us_data(code)

    # ------------------------------------------------------------------
    # A 股
    # ------------------------------------------------------------------
    def _get_a_share_data(self, stock_code):
        result = {
            "income": {},
            "cashflow": {},
            "income_quarter": {},
            "quarter_mode": "cumulative",
            "currency": "CNY",
        }

        # 利润表（年报+季报）
        try:
            params = {
                "type": "RPT_F10_FINANCE_MAINFINADATA",
                "sty": "ALL",
                "filter": '(SECUCODE="%s")' % stock_code,
                "p": 1,
                "ps": 200,
                "sr": "-1",
                "st": "REPORT_DATE",
                "source": "HSF10",
                "client": "PC"
            }
            resp = self.session.get(self.A_SHARE_URL, params=params, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('result') and data['result'].get('data'):
                    for item in data['result']['data']:
                        report_date = item.get('REPORT_DATE', '')
                        report_type = item.get('REPORT_TYPE', '')
                        if not report_date or len(report_date) < 4:
                            continue
                        year = int(report_date[:4])
                        if year < 2015:
                            continue
                        if report_type == '年报':
                            revenue = item.get('TOTALOPERATEREVE')
                            gross_profit = item.get('MLR')
                            net_profit = item.get('PARENTNETPROFIT') or item.get('NETPROFIT')
                            cost = None
                            if revenue and gross_profit:
                                try:
                                    cost = float(revenue) - float(gross_profit)
                                except Exception:
                                    pass
                            result['income'][year] = {
                                '营业收入': revenue,
                                '营业成本': cost,
                                '毛利润': gross_profit,
                                '归属于母公司股东的净利润': net_profit,
                            }
                        elif report_type in ['一季报', '中报', '三季报']:
                            qmap = {'一季报': '1', '中报': '2', '三季报': '3'}
                            quarter_key = "%sQ%s" % (year, qmap[report_type])
                            revenue = item.get('TOTALOPERATEREVE')
                            gross_profit = item.get('MLR')
                            net_profit = item.get('PARENTNETPROFIT') or item.get('NETPROFIT')
                            result['income_quarter'][quarter_key] = {
                                'year': year,
                                'quarter': report_type,
                                'revenue': self._number(revenue),
                                'gross_profit': self._number(gross_profit),
                                'net_profit': self._number(net_profit),
                                'date': report_date
                            }
            time.sleep(1)
        except Exception as e:
            logger.error("获取利润表失败: {}", e)

        # 现金流量表（年报）
        try:
            params = {
                "reportName": "RPT_DMSK_FN_CASHFLOW",
                "columns": "ALL",
                "filter": '(SECUCODE="%s")' % stock_code,
                "pageNumber": 1,
                "pageSize": 200,
                "sortColumns": "REPORT_DATE",
                "sortTypes": "-1"
            }
            resp = self.session.get(self.DATA_URL, params=params, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('result') and data['result'].get('data'):
                    year_data = {}
                    for item in data['result']['data']:
                        report_date = item.get('REPORT_DATE', '')
                        if report_date and len(report_date) >= 4:
                            year = int(report_date[:4])
                            if year >= 2015:
                                if year not in year_data or report_date > year_data[year]['date']:
                                    year_data[year] = {'date': report_date, 'item': item}
                    for year, value in year_data.items():
                        item = value['item']
                        result['cashflow'][year] = {
                            '经营活动产生的现金流量净额': item.get('NETCASH_OPERATE'),
                            '购建固定资产、无形资产和其他长期资产支付的现金': item.get('CONSTRUCT_LONG_ASSET') or item.get('BUY_FIXED_ASSET'),
                        }
            time.sleep(1)
        except Exception as e:
            logger.error("获取现金流量表失败: {}", e)

        return result

    # ------------------------------------------------------------------
    # 港股（年报 + 中报）
    # ------------------------------------------------------------------
    def _get_hk_data(self, stock_code):
        result = {
            "income": {},
            "cashflow": {},
            "income_quarter": {},
            "quarter_mode": "half_year",
            "currency": "HKD",
        }

        rows = self._request("RPT_HKF10_FN_MAININDICATOR", stock_code, page_size=200)
        annual_rows = {}
        interim_rows = {}
        for row in rows:
            report_date = row.get("REPORT_DATE") or ""
            if len(report_date) < 4:
                continue
            year = int(report_date[:4])
            if year < 2015:
                continue
            date_type = row.get("DATE_TYPE_CODE")
            report_type = row.get("REPORT_TYPE") or ""
            if date_type == "001" or "年报" in report_type:
                annual_rows[year] = row
            elif date_type == "002" or "中报" in report_type:
                interim_rows[year] = row

        for year, row in annual_rows.items():
            result["income"][year] = {
                "营业收入": row.get("OPERATE_INCOME"),
                "毛利润": row.get("GROSS_PROFIT"),
                "归属于母公司股东的净利润": row.get("HOLDER_PROFIT"),
            }

        for year in sorted(set(annual_rows.keys()) | set(interim_rows.keys())):
            interim = interim_rows.get(year)
            annual = annual_rows.get(year)

            if interim:
                self._append_period(
                    result, "%sH1" % year, year, "上半年",
                    interim.get("OPERATE_INCOME"),
                    interim.get("GROSS_PROFIT"),
                    interim.get("HOLDER_PROFIT"),
                    "half_year",
                )

            if interim and annual:
                self._append_period(
                    result, "%sH2" % year, year, "下半年",
                    self._diff(annual.get("OPERATE_INCOME"), interim.get("OPERATE_INCOME")),
                    self._diff(annual.get("GROSS_PROFIT"), interim.get("GROSS_PROFIT")),
                    self._diff(annual.get("HOLDER_PROFIT"), interim.get("HOLDER_PROFIT")),
                    "half_year",
                )

        time.sleep(1)

        cashflow_rows = self._request("RPT_HKSK_FN_CASHFLOW", stock_code, page_size=500)
        if cashflow_rows:
            result["currency"] = self._currency_code(cashflow_rows[0].get("CURRENCY"), "HKD")
        result["cashflow"] = self._build_annual_cashflow(
            cashflow_rows, ("005005", "005007")
        )
        time.sleep(1)

        return result

    # ------------------------------------------------------------------
    # 美股（单季度）
    # ------------------------------------------------------------------
    def _get_us_data(self, stock_code):
        result = {
            "income": {},
            "cashflow": {},
            "income_quarter": {},
            "quarter_mode": "single",
            "currency": "USD",
        }

        rows = self._request("RPT_USF10_FN_GMAININDICATOR", stock_code, page_size=500)
        if rows:
            result["currency"] = self._currency_code(
                rows[0].get("CURRENCY") or rows[0].get("CURRENCY_ABBR"), "USD"
            )

        for row in rows:
            report_type = row.get("REPORT_TYPE") or ""
            # 美股财年可能与自然年不同（如英伟达 FY 截止 1 月），
            # 必须从 REPORT_TYPE 提取年份，而非 REPORT_DATE。
            # REPORT_TYPE 格式: "2025/FY", "2026/Q1", "2026/Q2" 等
            type_year_match = re.match(r"^(\d{4})/", report_type)
            if not type_year_match:
                continue
            year = int(type_year_match.group(1))
            if year < 2015:
                continue

            if row.get("DATE_TYPE_CODE") == "001" or report_type.endswith("/FY"):
                result["income"][year] = {
                    "营业收入": row.get("OPERATE_INCOME"),
                    "毛利润": row.get("GROSS_PROFIT"),
                    "归属于母公司股东的净利润": row.get("PARENT_HOLDER_NETPROFIT"),
                }
                continue

            match = re.match(r"^\d{4}/Q([1-4])$", report_type)
            if not match:
                continue
            quarter = int(match.group(1))
            self._append_period(
                result, "%sQ%s" % (year, quarter), year,
                self._quarter_name(quarter),
                row.get("OPERATE_INCOME"),
                row.get("GROSS_PROFIT"),
                row.get("PARENT_HOLDER_NETPROFIT"),
                "quarter",
            )

        time.sleep(1)

        cashflow_rows = self._request("RPT_USSK_FN_CASHFLOW", stock_code, page_size=500)
        result["cashflow"] = self._build_annual_cashflow(
            cashflow_rows, ("005002", "005004")
        )
        time.sleep(1)

        return result

    # ------------------------------------------------------------------
    # 年度指标
    # ------------------------------------------------------------------
    def calculate_core_metrics(self, financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        metrics = []
        income_data = financial_data.get('income', {})
        cashflow_data = financial_data.get('cashflow', {})

        for year in sorted(income_data.keys(), reverse=True):
            if year < 2015:
                continue
            income = income_data.get(year, {})
            cashflow = cashflow_data.get(year, {})

            revenue = income.get('营业收入')
            gross_profit = income.get('毛利润')
            net_profit = income.get('归属于母公司股东的净利润')

            try:
                revenue_f = float(revenue)
                gross_profit_f = float(gross_profit) if gross_profit is not None else 0.0
                net_profit_f = float(net_profit) if net_profit is not None else 0.0
            except (TypeError, ValueError):
                continue
            if revenue_f <= 0:
                continue

            operating_cash = self._number(cashflow.get('经营活动产生的现金流量净额'))
            capex = self._number(cashflow.get('购建固定资产、无形资产和其他长期资产支付的现金'))
            if operating_cash is None and capex is None:
                free_cash_flow = None
            else:
                free_cash_flow = (operating_cash or 0) - abs(capex or 0)

            gross_margin = (gross_profit_f / revenue_f * 100) if revenue_f else 0
            net_margin = (net_profit_f / revenue_f * 100) if revenue_f else 0

            metrics.append({
                'report_year': year,
                'report_type': 'annual',
                'revenue': revenue_f,
                'gross_profit': gross_profit_f,
                'net_profit': net_profit_f,
                'gross_margin': round(gross_margin, 2),
                'net_margin': round(net_margin, 2),
                'free_cash_flow': free_cash_flow
            })

        return sorted(metrics, key=lambda x: x['report_year'], reverse=True)

    # ------------------------------------------------------------------
    # 季度/半年度指标
    # ------------------------------------------------------------------
    def get_quarterly_metrics(self, financial_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        mode = financial_data.get('quarter_mode', 'cumulative')
        if mode in ('single', 'half_year'):
            return self._format_existing_periods(financial_data, mode)

        # A 股：把累计季报逐季相减，得到单季度数据。
        quarters = financial_data.get('income_quarter', {})
        annual_income = financial_data.get('income', {})

        def build(year, quarter, quarter_name, revenue, gross_profit, net_profit):
            revenue_f = self._number(revenue)
            if revenue_f is None or revenue_f <= 0:
                return None
            gross_profit_f = self._number(gross_profit) or 0.0
            net_profit_f = self._number(net_profit) or 0.0
            gross_margin = (gross_profit_f / revenue_f * 100) if revenue_f else 0
            net_margin = (net_profit_f / revenue_f * 100) if revenue_f else 0
            return {
                'label': "%sQ%s" % (year, quarter),
                'year': year,
                'quarter': quarter_name,
                'revenue': revenue_f,
                'gross_profit': gross_profit_f,
                'net_profit': net_profit_f,
                'gross_margin': round(gross_margin, 2),
                'net_margin': round(net_margin, 2),
                'period_type': 'quarter',
            }

        years = sorted({
            q.get('year') for q in quarters.values() if q.get('year')
        })

        result = []
        for year in years:
            q1 = quarters.get('%sQ1' % year)
            q2 = quarters.get('%sQ2' % year)
            q3 = quarters.get('%sQ3' % year)
            annual = annual_income.get(year)

            # 第一季度：一季报本身就是单季度数据
            if q1:
                row = build(
                    year, 1, '第一季度',
                    q1.get('revenue'), q1.get('gross_profit'), q1.get('net_profit')
                )
                if row:
                    result.append(row)

            # 第二季度：中报（上半年累计）- 一季报
            if q1 and q2:
                row = build(
                    year, 2, '第二季度',
                    self._diff(q2.get('revenue'), q1.get('revenue')),
                    self._diff(q2.get('gross_profit'), q1.get('gross_profit')),
                    self._diff(q2.get('net_profit'), q1.get('net_profit')),
                )
                if row:
                    result.append(row)

            # 第三季度：三季报（前三季度累计）- 中报（上半年累计）
            if q2 and q3:
                row = build(
                    year, 3, '第三季度',
                    self._diff(q3.get('revenue'), q2.get('revenue')),
                    self._diff(q3.get('gross_profit'), q2.get('gross_profit')),
                    self._diff(q3.get('net_profit'), q2.get('net_profit')),
                )
                if row:
                    result.append(row)

            # 第四季度：全年 - 三季报（前三季度累计）
            if q3 and annual:
                row = build(
                    year, 4, '第四季度',
                    self._diff(annual.get('营业收入'), q3.get('revenue')),
                    self._diff(annual.get('毛利润'), q3.get('gross_profit')),
                    self._diff(annual.get('归属于母公司股东的净利润'), q3.get('net_profit')),
                )
                if row:
                    result.append(row)

        return result

    def _format_existing_periods(self, financial_data, mode):
        periods = financial_data.get('income_quarter', {})
        result = []
        default_type = 'half_year' if mode == 'half_year' else 'quarter'
        for key in sorted(periods.keys()):
            period = periods[key]
            revenue_f = self._number(period.get('revenue')) or 0.0
            gross_profit_f = self._number(period.get('gross_profit')) or 0.0
            net_profit_f = self._number(period.get('net_profit')) or 0.0
            gross_margin = (gross_profit_f / revenue_f * 100) if revenue_f else 0
            net_margin = (net_profit_f / revenue_f * 100) if revenue_f else 0
            result.append({
                'label': key,
                'year': period.get('year'),
                'quarter': period.get('quarter'),
                'revenue': revenue_f,
                'gross_profit': gross_profit_f,
                'net_profit': net_profit_f,
                'gross_margin': round(gross_margin, 2),
                'net_margin': round(net_margin, 2),
                'period_type': period.get('period_type', default_type),
            })
        return result
