import { describe, expect, it } from "vitest";
import { parseAmount, findAmounts } from "@/lib/parser/amount";
import { detectCategory } from "@/lib/parser/category";
import { parseMessage, splitItems } from "@/lib/parser/message";

describe("parseAmount", () => {
  const cases: [string, number | null][] = [
    ["5k", 5000],
    ["5K", 5000],
    ["5rb", 5000],
    ["5 rb", 5000],
    ["12 ribu", 12000],
    ["12.000", 12000],
    ["12,000", 12000],
    ["12000", 12000],
    ["1.250.000", 1250000],
    ["1,5jt", 1500000],
    ["1.5jt", 1500000],
    ["2jt", 2000000],
    ["2 juta", 2000000],
    ["rp5.000", 5000],
    ["Rp 12.500", 12500],
    ["300", 300000], // angka polos < 1000 dianggap ribuan
    ["0", null],
    ["abc", null],
    ["tempe 5k", null], // bukan string nominal murni
  ];
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("menandai angka polos sebagai ribuan yang diasumsikan", () => {
    const [a] = findAmounts("tempe 5");
    expect(a).toMatchObject({ value: 5000, assumedThousand: true, strong: false });
  });

  it("tidak menganggap jumlah/satuan sebagai uang", () => {
    expect(findAmounts("telur 2kg")).toHaveLength(0);
    expect(findAmounts("beras 2 kg 25k").map((a) => a.value)).toEqual([25000]);
  });
});

describe("detectCategory", () => {
  const cases: [string, string | null][] = [
    ["tempe", "makan"],
    ["telor ceplok", "makan"],
    ["beras 2kg", "makan"],
    ["indomie", "makan"],
    ["mie instan", "makan"],
    ["nasgor", "makan"],
    ["kecap", "makan"],
    ["galon", "makan"],
    ["kuota", "data"],
    ["paket data", "data"],
    ["sabun mandi", "darurat"],
    ["laundry", "darurat"],
    ["odol", "darurat"],
    ["ojek", null],
    ["", null],
    ["sabun telur", null], // campur dua amplop -> tanya, jangan tebak
  ];
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(detectCategory(input)).toBe(expected);
  });
});

describe("splitItems", () => {
  it("memisah beberapa item", () => {
    expect(splitItems("tempe 5k sama telur 14k")).toEqual(["tempe 5k", "telur 14k"]);
    expect(splitItems("tempe 5k, telur 14k")).toEqual(["tempe 5k", "telur 14k"]);
    expect(splitItems("tempe 5k + tahu 5k dan beras 25k")).toEqual(["tempe 5k", "tahu 5k", "beras 25k"]);
    expect(splitItems("tempe 5k\ntelur 14k")).toEqual(["tempe 5k", "telur 14k"]);
  });
  it("tidak memecah koma desimal", () => {
    expect(splitItems("hadiah 1,5jt")).toEqual(["hadiah 1,5jt"]);
  });
});

describe("parseMessage — 30+ contoh pesan santai", () => {
  const expense: [string, { nama: string; nominal: number; kode: string | null }[]][] = [
    ["tempe 5k", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["tempe 5rb", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["tempe 5.000", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["tempe 5000", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["Tempe 5K", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["beli telur 14rb", [{ nama: "telur", nominal: 14000, kode: "makan" }]],
    ["telor 14 ribu", [{ nama: "telor", nominal: 14000, kode: "makan" }]],
    ["5k tempe", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    ["rp5.000 tahu", [{ nama: "tahu", nominal: 5000, kode: "makan" }]],
    ["beras 2kg 25k", [{ nama: "beras 2kg", nominal: 25000, kode: "makan" }]],
    ["mie instan 3 bungkus 10k", [{ nama: "mie instan 3 bungkus", nominal: 10000, kode: "makan" }]],
    ["indomie 3.500", [{ nama: "indomie", nominal: 3500, kode: "makan" }]],
    ["kuota 30k", [{ nama: "kuota", nominal: 30000, kode: "data" }]],
    ["beli paket data 30rb", [{ nama: "paket data", nominal: 30000, kode: "data" }]],
    ["sabun 8k", [{ nama: "sabun", nominal: 8000, kode: "darurat" }]],
    ["laundry 15rb", [{ nama: "laundry", nominal: 15000, kode: "darurat" }]],
    ["odol 12k", [{ nama: "odol", nominal: 12000, kode: "darurat" }]],
    ["ojek 10k", [{ nama: "ojek", nominal: 10000, kode: null }]],
    ["fotokopi 2k", [{ nama: "fotokopi", nominal: 2000, kode: null }]],
    ["tempe 5", [{ nama: "tempe", nominal: 5000, kode: "makan" }]],
    [
      "tempe 5k sama telur 14k",
      [
        { nama: "tempe", nominal: 5000, kode: "makan" },
        { nama: "telur", nominal: 14000, kode: "makan" },
      ],
    ],
    [
      "tahu 5k, tempe 5k",
      [
        { nama: "tahu", nominal: 5000, kode: "makan" },
        { nama: "tempe", nominal: 5000, kode: "makan" },
      ],
    ],
    [
      "beras 25k + sabun 8k",
      [
        { nama: "beras", nominal: 25000, kode: "makan" },
        { nama: "sabun", nominal: 8000, kode: "darurat" },
      ],
    ],
    ["beras sama telur 40k", [{ nama: "beras sama telur", nominal: 40000, kode: "makan" }]],
  ];
  it.each(expense)("%s", (input, items) => {
    const r = parseMessage(input);
    expect(r.type).toBe("expense");
    if (r.type !== "expense") return;
    expect(r.items.map(({ nama, nominal, kode }) => ({ nama, nominal, kode }))).toEqual(items);
  });

  const simple: [string, string][] = [
    ["sisa", "sisa"],
    ["Sisa", "sisa"],
    ["saldo", "sisa"],
    ["hari ini", "hari_ini"],
    ["hariini", "hari_ini"],
    ["batal", "batal"],
    ["undo", "batal"],
    ["nol", "nol"],
    ["gak jajan", "nol"],
    ["ga jajan hari ini", "nol"],
    ["nggak jajan", "nol"],
    ["bantuan", "bantuan"],
    ["ok", "ok"],
    ["oke", "ok"],
    ["sip", "ok"],
    ["gak jadi", "tidak"],
    ["target", "target"],
    ["belanja", "belanja"],
    ["menu", "menu"],
    ["pindah 10k darurat ke makan alasan kurang", "pindah"],
    ["mau beli sepatu 200k", "mau_beli"],
    ["yakin ambil tabungan", "yakin_ambil"],
    ["3", "pilihan"],
    ["tempe", "unknown"],
    ["halo", "unknown"],
    ["", "unknown"],
  ];
  it.each(simple)("perintah %j -> %s", (input, type) => {
    expect(parseMessage(input).type).toBe(type);
  });

  const masuk: [string, number | null][] = [
    ["masuk 300", 300000],
    ["masuk 300rb", 300000],
    ["gajian 300k", 300000],
    ["masuk 250.000", 250000],
    ["masuk 1,5jt", 1500000],
    ["masuk", null],
  ];
  it.each(masuk)("%s -> %s", (input, nominal) => {
    expect(parseMessage(input)).toEqual({ type: "masuk", nominal });
  });

  it("bayar paylater", () => {
    expect(parseMessage("bayar paylater 50k")).toEqual({ type: "bayar_paylater", nominal: 50000 });
  });
});
