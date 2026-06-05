(function() {

class XPathHelper {
  static $(xpath, context = document) {
    try {
      const result = document.evaluate(
        xpath,
        context,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (error) {
      return null;
    }
  }

  static $$(xpath, context = document) {
    try {
      const result = document.evaluate(
        xpath,
        context,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      const elements = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        elements.push(result.snapshotItem(i));
      }
      return elements;
    } catch (error) {
      return [];
    }
  }

  static exists(xpath, context = document) {
    return this.$(xpath, context) !== null;
  }

  static fromElement(element, xpath) {
    return this.$(xpath, element);
  }

  static getText(xpath, context = document) {
    const element = this.$(xpath, context);
    return element ? element.textContent.trim() : '';
  }

  static getAttribute(xpath, attr, context = document) {
    const element = this.$(xpath, context);
    return element ? element.getAttribute(attr) : null;
  }
}

window.XPathHelper = XPathHelper;

})();