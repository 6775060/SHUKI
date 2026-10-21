var rFeedbackBtn = document.querySelector(".r-feedback-btn");
if (rFeedbackBtn) { // the feedback button is not on every page
  rFeedbackBtn.addEventListener("click", function(){
    document.querySelector(".r-feedback").classList.toggle("open");
  });
}
