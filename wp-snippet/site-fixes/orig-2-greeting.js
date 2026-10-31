function updateGreeting() {
  const now = new Date();
  const currentHour = now.getHours();
  const spanElement = document.querySelector('#go_to_account .elementor-button-text');
  const spanElementText = spanElement.textContent;
  let greeting;
	let icon;
  
  if (currentHour >= 6 && currentHour < 12) {
    greeting = 'בוקר טוב';
		icon = '<img width="20" src="https://fontshok.co.il/wp-content/uploads/2024/07/Good-Morning.svg">';
  } else if (currentHour >= 12 && currentHour < 18) {
    greeting = 'צהריים טובים';
		icon = '<img width="20" src="https://fontshok.co.il/wp-content/uploads/2024/07/Good-afternoon.svg">';
  } else {
    greeting = 'ערב טוב';
		icon = '<img width="20" src="https://fontshok.co.il/wp-content/uploads/2024/07/good-eveningnight.svg">';
  }
  
  spanElement.innerHTML = `${greeting} ${spanElementText} ${icon}`;
	
	
// 	spanElement.addEventListener('mouseenter', function(){
// 		spanElement.innerHTML = 'לאזור האישי שלך <img width="16" src="https://fontshok.co.il/wp-content/uploads/2024/07/profile.svg">';
// 	});
// 	spanElement.addEventListener('mouseleave', function(){
// 	  spanElement.innerHTML = `${greeting} ${spanElementText} ${icon}`;
// 	});


}

// Call the function to update the greeting
updateGreeting();

	
