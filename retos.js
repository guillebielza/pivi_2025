const pointsEl = document.getElementById("points");

function getPoints() {
  return Number(localStorage.getItem("points")) || 0;
}

function setPointsUI() {
  if (pointsEl) pointsEl.textContent = String(getPoints());
}

setPointsUI();
