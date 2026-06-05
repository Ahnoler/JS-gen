(function() {

class SmartSelector {
  constructor(element) {
    this.element = element;
    this.semanticTags = ['button', 'input', 'a', 'img', 'textarea', 'select'];
    this.testAttributes = [
       'id', 'label', 'data-testid', 'data-cy', 'data-test', 'data-qa',
    ];
  }

  getSelector() {
    const idOrTestAttrXPath = this.findUniqueIdOrTestAttrXPath();
    if (idOrTestAttrXPath) {
      return idOrTestAttrXPath;
    }

    const uniquePlaceholderXPath = this.findUniquePlaceholderXPath();
    if (uniquePlaceholderXPath) {
      return uniquePlaceholderXPath;
    }

    const uniqueAttrXPath = this.findUniqueAttributeXPath();
    if (uniqueAttrXPath) {
      return uniqueAttrXPath;
    }

    const textXPath = this.findTextXPath();
    if (textXPath) {
      return textXPath;
    }

    return this.getXPathFromElement();
  }

  findUniqueIdOrTestAttrXPath() {
    for (const attr of this.testAttributes) {
      if (this.element.hasAttribute(attr)) {
        const value = this.element.getAttribute(attr);

        if (attr === 'id' && (/\d{4,}/.test(value) || /^[a-zA-Z0-9]{10,}$/.test(value) || /^el-id-.*$/.test(value))) {
          continue;
        }

        let xpath = this.getUpperSpecialElementXPath(this.element)
        if (attr === 'id') {
          xpath = xpath + `//*[@id="${value}"]`;
        } else {
          xpath = xpath + `//*[@${attr}="${value}"]`;
        }

        if (this.isUniqueXPath(xpath)) {
          return xpath;
        }
      }
    }
    return null;
  }

  findUniquePlaceholderXPath(){
    const selectElement = this.element.closest(".el-select")
    if(!selectElement){
      const tagName = this.element.tagName.toLowerCase();
      if (this.element.hasAttribute('placeholder')) {
        const value = this.element.getAttribute('placeholder');
        if (value && value.length <= 20){
            let upperXpath = this.getUpperSpecialElementXPath(this.element)
            const xpath = upperXpath + `//${tagName}[@placeholder="${value}"]`;
            if (this.isUniqueXPath(xpath)) return xpath;
        }
      }
    }
    return null;
  }

  findUniqueAttributeXPath() {
    const usefulAttrs = ['name','title' ,'class' , 'alt', 'type' ];
    const tagName = this.element.tagName.toLowerCase();

    for (const attr of usefulAttrs) {
      if (this.element.hasAttribute(attr)) {
        const value = this.element.getAttribute(attr);
        if (value && value.length > 20) continue;

        let upperXpath = this.getUpperSpecialElementXPath(this.element)
        const xpath = upperXpath + `//${tagName}[@${attr}="${value}"]`;
        if (this.isUniqueXPath(xpath)) return xpath;
      }
    }
    return null;
  }

  findTextXPath() {
    const tagName = this.element.tagName.toLowerCase();
    let text = '';

    if (this.element.innerText) {
      text = this.element.innerText.trim();
    } else if (this.element.textContent) {
      text = this.element.textContent.trim();
    }

    if (text && text.length <= 20 && text.length > 0) {
      let upperXpath = this.getUpperSpecialElementXPath(this.element)
      const exactXPath = upperXpath + `//${tagName}[normalize-space()="${text}"]`;
      if (this.isUniqueXPath(exactXPath)) return exactXPath;
    }
    return null;
  }

  getUpperSpecialElementXPath(element) {
    const dialogElement = this.element.closest(".el-dialog__wrapper")
    const popoverElement = this.element.closest('.el-popover:not(.el-popover_)');

    if(dialogElement && dialogElement.style.display !== "none"){
      return `//div[contains(@class, "el-dialog__wrapper")][not(contains(@style, "display: none"))]`
    }else if(popoverElement && popoverElement.style.display !== "none"){
      return `//div[contains(@class, "el-popover")][not (contains(@class, "el-popover_"))][not(contains(@style, "display: none"))]`
    }
    return ''
  }

  getUniqueUpperElementXPath(uppperElement ,upperXpath){
    let specialObj = {
      element : uppperElement,
      specialFatherXPath : `//${upperXpath}`
    }
    if (this.isUniqueXPath(specialObj.specialFatherXPath, specialObj.element)) {
      const directXPath = this.getXPath(this.element,'' ,specialObj);
      return  directXPath
    }else {
      const specialFatherXPath = this.getXPath(uppperElement.parentNode, upperXpath);
      specialObj.specialFatherXPath = specialFatherXPath
      const directXPath = this.getXPath(this.element,'' ,specialObj);
      return directXPath;
    }
  }

  getXPathFromElement() {
    const dialogElement = this.element.closest(".el-dialog__wrapper")
    const popoverElement = this.element.closest('.el-popover:not(.el-popover_)');

    if(dialogElement && dialogElement.style.display !== "none"){
      const dialogElementXpath = `div[contains(@class, "el-dialog__wrapper")][not(contains(@style, "display: none"))]`
      this.getUniqueUpperElementXPath(dialogElement ,dialogElementXpath)

    }else if(popoverElement && popoverElement.style.display !== "none"){
      const popoverXpath = `div[contains(@class, "el-popover")][not (contains(@class, "el-popover_"))][not(contains(@style, "display: none"))]`
      this.getUniqueUpperElementXPath(popoverElement ,popoverXpath)
    }

    return this.getXPath(this.element, '');
  }

getXPath(element, childPath = '' , specialObj = null) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE || (specialObj && element === specialObj.element)) {
    return childPath;
  }

  const currentLocator = this.getElementLocator(element);
  const currentClassLocator = this.getElementClassLocator(element);

  let fullPath;
  let fullClassPath;
  if (childPath === '') {
    fullPath = currentLocator;
    fullClassPath = currentClassLocator;
  } else {
    fullPath = `${currentLocator}/${childPath}`;
    fullClassPath = `${currentClassLocator}/${childPath}`;
  }

  let currentTestXPath = `//${fullPath}`;
  let currentClassTestXPath = `//${fullClassPath}`;

  if(specialObj && specialObj.specialFatherXPath){
    currentTestXPath = `${specialObj.specialFatherXPath}//${fullPath}`;
    currentClassTestXPath = `${specialObj.specialFatherXPath}//${fullClassPath}`;
  }

  if (currentTestXPath && this.isUniqueXPath(currentTestXPath, this.element)) {
    return currentTestXPath;
  }else if(currentClassTestXPath && this.isUniqueXPath(currentClassTestXPath, this.element)){
    return currentClassTestXPath;
  }

  return this.getXPath(element.parentNode, fullPath ,specialObj);
}

getElementLocator(element) {
  const tagName = element.tagName.toLowerCase();
  for (const attr of this.testAttributes) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);

      if (attr === 'id' && (/\d{4,}/.test(value) || /^[a-zA-Z0-9]{10,}$/.test(value) || /^el-id-.*$/.test(value))) {
        continue;
      }

      return `${tagName}[@${attr}="${value}"]`;
    }
  }

  const selectElement = element.closest(".el-select");
  if (!selectElement && element.hasAttribute('placeholder')) {
    const value = element.getAttribute('placeholder');
    if (value && value.length <= 20 && value.trim() !== '') {
      return `${tagName}[@placeholder="${value}"]`;
    }
  }

  const usefulAttrs = ['name', 'title', 'alt', 'type'];
  for (const attr of usefulAttrs) {
    if (element.hasAttribute(attr)) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 20 && value.trim() !== '') {
        return `${tagName}[@${attr}="${value}"]`;
      }
    }
  }

  return this.getElementDefaultLocator(element);
}

getElementClassLocator(element){
  const tagName = element.tagName.toLowerCase();
  if (element.hasAttribute('class')) {
    const value = element.getAttribute('class');
    if (value && value.length <= 20 && value.trim() !== '') {
      return `${tagName}[@class="${value}"]`;
    }
  }
  return ''
}

getElementDefaultLocator(element) {
  const tagName = element.tagName.toLowerCase();
  const parent = element.parentNode;

  if (!parent || parent.nodeType !== Node.ELEMENT_NODE) {
    return tagName;
  }

  const siblings = Array.from(parent.children).filter(child =>
    child.tagName === element.tagName
  );

  if (siblings.length === 1) {
    return tagName;
  } else {
    const index = siblings.indexOf(element) + 1;
    return `${tagName}[${index}]`;
  }
}

  isUniqueXPath(xpath , context = document) {
    try {
      let elementNodeArr = getElementsByXPathWithShadow(xpath)
      return elementNodeArr?.length === 1 ;
    } catch (e) {
      console.warn('XPath 解析错误:', e, 'XPath:', xpath);
      return false;
    }
  }

  generateXPathWithAttributes(element, attributes = []) {
    const tagName = element.tagName.toLowerCase();

    for (const attr of attributes) {
      if (element.hasAttribute(attr)) {
        const value = element.getAttribute(attr);
        if (value && value.length < 100) {
          const xpath = `//${tagName}[@${attr}="${value}"]`;
          if (this.isUniqueXPath(xpath)) {
            return xpath;
          }
        }
      }
    }

    return null;
  }
}

function getElementsByXPathWithShadow(xpath, root = document) {
  const results = new Set();

  findInDocument(xpath, root, results);

  findAllShadowRoots(root).forEach(shadowRoot => {
    findInDocument(xpath, shadowRoot, results);
  });

  findAllIframes(root).forEach(iframeDoc => {
    findInDocument(xpath, iframeDoc, results);
  });

  return Array.from(results);
}

function findInDocument(xpath, doc, results) {
  try {
    const iterator = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.ORDERED_NODE_ITERATOR_TYPE,
      null
    );

    let node;
    while (node = iterator.iterateNext()) {
      if (node.nodeType === Node.ELEMENT_NODE && node.isConnected) {
        results.add(node);
      }
    }
  } catch (e) {
    console.warn(`在文档中查找失败:`, e);
  }
}

function findAllShadowRoots(element) {
  const shadowRoots = [];

  function traverse(el) {
    if (el.shadowRoot) {
      shadowRoots.push(el.shadowRoot);
      el.shadowRoot.querySelectorAll('*').forEach(child => traverse(child));
    }

    if (el.children) {
      Array.from(el.children).forEach(child => traverse(child));
    }
  }

  traverse(element);
  return shadowRoots;
}

function findAllIframes(element) {
  const iframeDocs = [];

  element.querySelectorAll('iframe').forEach(iframe => {
    try {
      if (iframe.contentDocument) {
        iframeDocs.push(iframe.contentDocument);
        iframeDocs.push(...findAllIframes(iframe.contentDocument));
      }
    } catch (e) {
    }
  });

  return iframeDocs;
}

window.SmartSelector = SmartSelector;
window.getElementsByXPathWithShadow = getElementsByXPathWithShadow;

})();