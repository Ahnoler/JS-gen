(function() {

function getLabelByFor(element) {
  if (!element.id) return null;
  const label = document.querySelector(`label[for="${element.id}"]`);
  return label ? label.textContent.trim() : null;
}

function getWrappingLabel(element) {
  let label = element.closest('label');
  if(label){
    return label.textContent.trim();
  }

  let formItemContent = element.closest('.el-form-item');
  let formItemContentnavite = element.closest('.n-form-item');

  if(formItemContent){
    label = formItemContent.querySelector('label')
  }else if(formItemContentnavite){
    label = formItemContentnavite.querySelector('.n-form-item-label__text')
  }
  return label ? label.textContent.trim() : null;
}

function getAriaLabel(element) {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel ) {
    return ariaLabel.trim();
  }

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElements = labelledBy.split(' ')
      .map(id => document.getElementById(id))
      .filter(el => el);

    const chineseText = labelElements
      .map(el => el.textContent.trim())

    if (chineseText) return chineseText;
  }

  return null;
}

function getAttributeLabel(element){
   const title = element.getAttribute('title');
   const label = element.getAttribute('label');
   if (title || label) {
    return title.trim()  || label.trim();
  }
  return  null;
}

function getPlaceHolderLabel(element) {
  const placeholder = element.getAttribute('placeholder');
  if(placeholder){
    if(placeholder.includes('请选择您的') || placeholder.includes('请输入您的') ||placeholder.includes('请填写您的')){
        let trimPlaceHoldder =  placeholder.replace('请选择您的', '').replace('请输入您的', '').replace('请填写您的', '').trim();
        if(trimPlaceHoldder){
          return trimPlaceHoldder;
        }else{
          return null;
        }
    }else if (placeholder.includes('请选择') || placeholder.includes('请输入') ||placeholder.includes('请填写')){
        let trimPlaceHoldder =  placeholder.replace('请选择', '').replace('请输入', '').replace('请填写', '').trim();
        if(trimPlaceHoldder){
          return trimPlaceHoldder;
        }else{
          return null;
        }
    } else if(placeholder.includes('选择') || placeholder.includes('输入') ||placeholder.includes('填写')){
      let trimPlaceHoldder =  placeholder.replace('选择', '').replace('输入', '').replace('填写', '').trim();
      if(trimPlaceHoldder){
        return trimPlaceHoldder;
      }else{
        return null;
      }
    }else{
      return placeholder.trim();
    }
  }else{
    return null;
  }
}

function getDataAttributesLabel(element) {
  const dataAttrs = [
    'data-label', 'data-title', 'data-name',
    'data-placeholder', 'data-tip', 'data-text'
  ];

  for (const attr of dataAttrs) {
    const value = element.getAttribute(attr);
    if (value && value.length >= 1 && value.length <= 50) {
      return value.trim();
    }
  }

  return null;
}

function getTextContentLabel(element) {
  const tagName = element.tagName.toLowerCase();
  let textContentStr = ''
  if (['button', 'a', '[role="button"]'].includes(tagName)) {
    textContentStr = element.textContent.trim();
  }else if ((tagName === 'div' || tagName === 'p' || tagName === 'span') && element.children.length == 0) {
    textContentStr = element.textContent.trim();
  }else {
    const parent = element.closest('button, a, [role="button"] , span');
    if(parent){
      textContentStr = parent.textContent.trim();
    }
  }

  if (textContentStr && textContentStr.length >= 1 && textContentStr.length <= 50) {
    return textContentStr;
  }
  return null;
}

function getAdjacentLabelText(element) {
  let prev = element.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL') {
      return prev.textContent.trim();
    }
    if (prev.textContent && prev.textContent.trim()) {
      return prev.textContent.trim();
    }
    prev = prev.previousElementSibling;
  }

  const parentText = element.parentElement.textContent.trim();
  const elementText = element.textContent || element.value || '';

  return parentText.replace(elementText, '').trim();
}

function getContextualLabel(element) {
  const containers = ['div', 'section', 'article', 'form', 'fieldset', 'td', 'th'];
  let container = element.parentElement;

  while (container) {
    const text = container.textContent.trim();
    const elementText = element.textContent || element.value || element.placeholder || '';

    if (text && text !== elementText) {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      for (const line of lines) {
        if (/[\u4e00-\u9fa5]{2,}/.test(line) &&
            line.length < 50 &&
            !line.includes(elementText)) {
          return line;
        }
      }
    }

    if (container.tagName === 'FIELDSET') {
      const legend = container.querySelector('legend');
      if (legend && /[\u4e00-\u9fa5]/.test(legend.textContent)) {
        return legend.textContent.trim();
      }
    }

    container = container.parentElement;
  }

  return null;
}

function getChineseLabelByElement(element) {
  try {
    if (!element) {
      return null;
    }

    const strategies = [
      () => getLabelByFor(element),
      () => getWrappingLabel(element),
      () => getAriaLabel(element),
      () => getAttributeLabel(element),
      () => getPlaceHolderLabel(element),
      () => getDataAttributesLabel(element),
      () => getTextContentLabel(element),
    ];

    for (const strategy of strategies) {
      const result = strategy();
      if (result ) {
        return result.replace(/\s+/g, ' ').replace(/[\r\n\t]/g, '');
      }
    }

    return null;

  } catch (error) {
    return null;
  }
}

window.getChineseLabelByElement = getChineseLabelByElement;

})();