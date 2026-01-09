import pandas as pd
import json
from pathlib import Path
import os

# ====== RUTAS (misma carpeta que el script) ======
BASE_DIR = Path(__file__).resolve().parent
EXCEL_FILE = BASE_DIR / "datos.xlsx"

RECOMPENSAS_JSON = BASE_DIR / "recompensas.json"

def clean(col):
    return str(col).strip()

def norm_value(v):
    if pd.isna(v):
        return ""
    if isinstance(v, str):
        return v.strip()
    return v

def to_bool_si_no(v):
    if isinstance(v, str):
        return v.strip().upper() == "SI"
    return False

def write_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

print("📌 Script:", BASE_DIR)
print("📌 Excel :", EXCEL_FILE)

if not EXCEL_FILE.exists():
    raise FileNotFoundError(f"No existe datos.xlsx en {BASE_DIR}")

# ==============================
# RECOMPENSAS
# ==============================
df_rewards = pd.read_excel(EXCEL_FILE, sheet_name="Recompensas")
df_rewards.columns = [clean(c) for c in df_rewards.columns]

required_rewards = {
    "Tipo", "Texto Botón", "Coste",
    "Mensaje Pop Up", "Mensaje Histórico",
    "Disponible"
}

missing = required_rewards - set(df_rewards.columns)
if missing:
    raise ValueError(f"Faltan columnas en Recompensas: {missing}")

recompensas = []
for idx, row in df_rewards.iterrows():
    recompensas.append({
        "id": idx + 1,
        "tipo": norm_value(row["Tipo"]),
        "textoBoton": norm_value(row["Texto Botón"]),
        "coste": int(row["Coste"]),
        "disponible": to_bool_si_no(row["Disponible"]),
        "mensajePopup": norm_value(row["Mensaje Pop Up"]),
        "mensajeHistorico": norm_value(row["Mensaje Histórico"]),
    })

write_json(RECOMPENSAS_JSON, recompensas)
print(f"✔ recompensas.json generado ({len(recompensas)} filas)")

print("\n🎉 JSON de recompensas actualizado correctamente")
