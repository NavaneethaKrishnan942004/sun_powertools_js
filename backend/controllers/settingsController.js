const getMasters = (req, res) => {
    res.render('masters', {
        pageTitle: 'Masters'
    });
};

const getSettings = (req, res) => {
    res.render('settings', {
        pageTitle: 'Settings & Preferences'
    });
};

module.exports = {
    getMasters,
    getSettings
};
