/* runs only on font pages: on other pages the purchase window does not exist */
if (document.querySelector(".r-font-purchase")) {

  //open purchase popup
  document.querySelectorAll(".r-open-purchase").forEach((e) => {
    e.addEventListener("click", function () {
      document.querySelector(".r-font-purchase").style.display = "flex";
    });
  });
  document.querySelector(".r-close-purchase").addEventListener("click", function () {
    document.querySelector(".r-font-purchase").style.display = "none";
  });
  document.querySelector(".r-font-purchase").addEventListener("click", function (event) {
    const popup = document.querySelector(".r-font-purchase-div");

    // Check if the click target is outside the popup
    if (!popup.contains(event.target)) {
      document.querySelector(".r-font-purchase").style.display = "none";
    }
  });

  //creat view cart button

  const rViewCartButton = document.createElement("div");
  rViewCartButton.innerHTML =
    '<span>לסל</span><svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none"> <path d="M11.8567 32C13.303 32 14.4756 30.8061 14.4756 29.3333C14.4756 27.8606 13.303 26.6667 11.8567 26.6667C10.4103 26.6667 9.23779 27.8606 9.23779 29.3333C9.23779 30.8061 10.4103 32 11.8567 32Z" stroke="#737373" stroke-linecap="round" stroke-linejoin="round"/> <path d="M26.2605 32C27.7069 32 28.8794 30.8061 28.8794 29.3333C28.8794 27.8606 27.7069 26.6667 26.2605 26.6667C24.8141 26.6667 23.6416 27.8606 23.6416 29.3333C23.6416 30.8061 24.8141 32 26.2605 32Z" stroke="#737373" stroke-linecap="round" stroke-linejoin="round"/> <path d="M26.2605 26.6667H11.8567V8H9.23779" stroke="#737373" stroke-linecap="round" stroke-linejoin="round"/> <path d="M11.8567 10.6667L30.1889 12L28.8794 21.3333H11.8567" stroke="#737373" stroke-linecap="round" stroke-linejoin="round"/> </svg>';

  rViewCartButton.classList.add("r-view-cart-btn");
  const rAddToCartButton = document.querySelector(".pvtfw_variant_table_bulk_cart_btn");
  rAddToCartButton.insertAdjacentElement("beforebegin", rViewCartButton);

  rViewCartButton.addEventListener("click", function () {
    document.querySelector(".elementor-widget-woocommerce-menu-cart").classList.add("elementor-menu-cart--shown");
    btnLoader();
  });

  const rCloseButton = document.querySelector(".elementor-menu-cart__close-button-custom");
  if (rCloseButton) {
    rCloseButton.addEventListener("click", function () {
      document.querySelector(".elementor-widget-woocommerce-menu-cart").classList.remove("elementor-menu-cart--shown");
    });
  }

  //add elements

  const fontDemo = document.createElement("div");
  fontDemo.innerHTML =
    '<div class="r-family-discount-con"><div class="r-original-price"></div><div class="r-family-discount"></div></div><div class="r-font-demo-con"><div class="r-Total-con" style="display:none;">מספר משקלם: <span class="checked-number" style="display:none;">0</span></div><div class="r-Total-con">סה"כ: <span class="my-total-price">0</span></div></div>';
  const roniVariantTableBlock = document.querySelector(".pvtfw_init_variation_table>form");
  roniVariantTableBlock.parentNode.insertBefore(fontDemo, roniVariantTableBlock);

  //add class and click

  var trList = document.querySelectorAll(".pvt-tr");

  trList.forEach(function (tdclass) {
    //add class 1

    if (tdclass.innerHTML.includes("דסקטופ")) {
      tdclass.classList.add("desktop");
    }
    //   else if (tdclass.innerHTML.includes("ווב") ) {
    //       tdclass.classList.add("web");
    //   }
    else if (tdclass.innerHTML.includes("וובפונט")) {
      tdclass.classList.add("webstop");
    }

    //add class family

    if (tdclass.innerHTML.includes("משפחה")) {
      tdclass.classList.add("family");
    }

    //add fw data
    let rows = document.querySelectorAll(".pvt-tr.desktop");
    rows.forEach((row, index) => {
      row.setAttribute("data-fw", index * 100);
    });
    let rowsWeb = document.querySelectorAll(".pvt-tr.webstop");
    rowsWeb.forEach((row, index) => {
      row.setAttribute("data-fw", index * 100);
    });

    //font w demo

    const fontDemo = document.querySelector(".r-font-text-demo");

    tdclass.addEventListener("mouseover", () => {
      const fontWeight = tdclass.getAttribute("data-fw");
      fontDemo.style.fontWeight = fontWeight;
    });

    tdclass.addEventListener("mouseout", () => {
      fontDemo.style.fontWeight = "normal";
    });

    //click

    tdclass.addEventListener("click", function (event) {
      this.querySelector("input[type=checkbox]").click();
    });

    //items number

    const checkboxes = document.querySelectorAll("input.var_checkbox");
    const checkedNumber = document.querySelector(".checked-number");

    checkboxes.forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const checkedCount = document.querySelectorAll("input.var_checkbox:checked").length;
        checkedNumber.textContent = checkedCount;
      });
    });

    //total price

    const totalPrice = document.querySelector(".my-total-price");

    checkboxes.forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        const price = checkbox.value;
        totalPrice.textContent = price;
        if (document.querySelector(".family-discount")) {
          const discountPercent = document.querySelector(".family-discount").textContent;
          const originalPrice = price / (1 - discountPercent / 100);
          const priceMargin = originalPrice - price;
          document.querySelector(".r-original-price").textContent = "מחיר לפני הנחה: " + originalPrice + " ₪";
          document.querySelector(".r-family-discount").textContent = "הנחה: " + priceMargin + "- ₪";
        }
      });
    });

    // When a family checkbox is clicked, toggle the state of non-family checkboxes
    const familyCheckboxes = document.querySelectorAll(".pvt-tr.family input[type=checkbox]");
    const nonFamilyCheckboxes = document.querySelectorAll(".pvt-tr:not(.family) input[type=checkbox]");

    familyCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", function () {
        if (this.checked) {
          const nonFamilyCheckboxesChecked = document.querySelectorAll(".pvt-tr:not(.family) input[type=checkbox]:checked");
          nonFamilyCheckboxesChecked.forEach((e) => {
            e.click();
          });
          nonFamilyCheckboxes.forEach((nonFamilyCheckbox) => {
            nonFamilyCheckbox.disabled = true;
          });
        } else {
          nonFamilyCheckboxes.forEach((nonFamilyCheckbox) => {
            nonFamilyCheckbox.disabled = false;
          });
        }
      });
    });

    //tabs

    var rbtndesktop = document.querySelector(".r-btn-desktop");
    // var rbtnweb = document.querySelector('.r-btn-web');
    var rbtnextra = document.querySelector(".r-btn-webstop");
    var rfontrpurchase = document.querySelector(".r-font-purchase");

    rbtndesktop.addEventListener("click", function () {
      rfontrpurchase.classList.add("desktop-active");
      rfontrpurchase.classList.remove("web-active", "webstop-active");
    });

    // rbtnweb.addEventListener('click', function (){
    // rfontrpurchase.classList.add('web-active');
    // rfontrpurchase.classList.remove('desktop-active', 'webstop-active');
    // });

    rbtnextra.addEventListener("click", function () {
      rfontrpurchase.classList.add("webstop-active");
      rfontrpurchase.classList.remove("desktop-active", "web-active");
    });

    //font demo
    //font family
    const fontTitle = document.querySelector(".elementor-widget-GlyphsViewWidget .gliph_box_large");
    const computedStyle = window.getComputedStyle(fontTitle);
    const fontFamily = computedStyle.fontFamily;
    document.querySelector(".r-font-text").style.fontFamily = fontFamily;

    //font size and weight
    document.querySelector(".r-font-text").style.fontSize = document.querySelector(".fonts-size").innerText + "px";
    document.querySelector(".r-font-text").style.fontWeight = document.querySelector(".fonts-weight").innerText;
  });
  const fontName = document.querySelector(".r-fonts-name h2");
  if (fontName) {
    document.querySelector(".desktop.family > td:nth-child(3)").innerText = "משפחת " + fontName.innerText;
    document.querySelector(".webstop.family > td:nth-child(3)").innerText = "משפחת " + fontName.innerText;
  }

  //add to cart

  document.querySelector("#bulk_cart").innerText = "הוספה לסל";

  jQuery("#bulk_cart").click(function () {
    jQuery(document.body).one("wc_fragment_refresh", function () {
      jQuery("#elementor-menu-cart__toggle_button").click();
      jQuery(".var_checkbox").prop("checked", false);
      jQuery("#bulk_cart").prop("disabled", true);
      btnLoader();
    });
  });

  //btn loader
  document.querySelector(".elementor-widget-woocommerce-menu-cart").addEventListener("click", btnLoader);
  function btnLoader() {
    console.log("hello");
    document.querySelector(".elementor-button--checkout").addEventListener("click", function () {
      document.querySelector(".elementor-button--checkout").classList.add("r-loader");
    });
  }

  document.querySelector(".pvtfw_variant_table_bulk_cart_btn").addEventListener("click", function () {
    document.querySelector(".pvtfw_variant_table_bulk_cart_btn").classList.add("r-loader");
  });
}
