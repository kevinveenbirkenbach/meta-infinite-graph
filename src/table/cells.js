class TableCells {
  constructor(roleInfo) {
    this.roleInfo = roleInfo;
  }

  static _fmtBytes(value) {
    if (value === null || value === undefined) return '-';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
      size /= 1000;
      unit += 1;
    }
    const rounded = Math.round(size * 100) / 100;
    return `${rounded} ${units[unit]}`;
  }

  static _fmtNumber(value) {
    return value === null || value === undefined ? '-' : String(value);
  }

  static _fmtVariant(variant) {
    return variant === null || variant === undefined ? '-' : String(variant);
  }

  static _cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  _roleCell(role, tag = 'td') {
    const cell = document.createElement(tag);
    cell.dataset.roleName = role;
    cell.appendChild(this.roleInfo.label(role));
    return cell;
  }

  _roleListCell(roles) {
    const cell = document.createElement('td');
    if (!roles.length) {
      cell.textContent = '-';
      return cell;
    }
    cell.className = 'role-list';
    roles.forEach((role, index) => {
      const item = document.createElement('span');
      item.dataset.roleName = role;
      item.appendChild(this.roleInfo.label(role));
      cell.appendChild(item);
      if (!this.roleInfo.symbols && index < roles.length - 1) {
        cell.appendChild(document.createTextNode(', '));
      }
    });
    return cell;
  }

  _boolCell(value) {
    const cell = document.createElement('td');
    if (!this.roleInfo.symbols) {
      cell.textContent = value ? 'yes' : 'no';
      return cell;
    }
    const icon = document.createElement('i');
    icon.className = value ? 'fa-solid fa-check' : 'fa-solid fa-xmark';
    cell.title = value ? 'yes' : 'no';
    cell.className = 'bool';
    cell.appendChild(icon);
    return cell;
  }

  _wrap(title, note, table) {
    const section = document.createElement('div');
    section.className = 'table-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const caption = document.createElement('p');
    caption.className = 'table-note';
    caption.textContent = note;
    const scroller = document.createElement('div');
    scroller.className = 'table-scroll';
    scroller.appendChild(table);
    section.append(heading, caption, scroller);
    return section;
  }
}

window.TableCells = TableCells;
