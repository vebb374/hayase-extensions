import AbstractSource from './abstract.js'

const QUALITIES = ['2160', '1080', '720', '540', '480']

export default new class SukebeiNyaa extends AbstractSource {
  url = 'https://sukebei.nyaa.si'

  /**
   * Parse size string to bytes
   * @param {string} sizeStr - Size string like "1.5 GiB"
   * @returns {number} Size in bytes
   */
  parseSize(sizeStr) {
    const match = sizeStr.match(/^([\d.]+)\s*([KMGT]?i?B)$/i)
    if (!match) return 0
    
    const size = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    
    const multipliers = {
      'B': 1,
      'KB': 1000,
      'KIB': 1024,
      'MB': 1000000,
      'MIB': 1048576,
      'GB': 1000000000,
      'GIB': 1073741824,
      'TB': 1000000000000,
      'TIB': 1099511627776
    }
    
    return Math.floor(size * (multipliers[unit] || 1))
  }

  /**
   * Parse search results from HTML
   * @param {string} html - HTML content
   * @returns {import('./').TorrentResult[]}
   */
  parseResults(html) {
    const results = []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    
    const rows = doc.querySelectorAll('tbody tr')
    
    for (const row of rows) {
      const cells = row.querySelectorAll('td')
      if (cells.length < 7) continue
      
      try {
        // Extract title and description link
        const titleLink = cells[1].querySelector('a')
        if (!titleLink) continue
        
        const title = titleLink.textContent.trim()
        const descLink = titleLink.getAttribute('href')
        
        // Extract download links - get the last link which should be magnet/torrent
        const downloadLinks = cells[2].querySelectorAll('a')
        const lastLink = downloadLinks[downloadLinks.length - 1]
        if (!lastLink) continue
        
        let downloadUrl = lastLink.getAttribute('href')
        if (!downloadUrl.startsWith('http') && !downloadUrl.startsWith('magnet:')) {
          downloadUrl = this.url + downloadUrl
        }
        
        // Extract size
        const sizeText = cells[3].textContent.trim()
        const size = this.parseSize(sizeText)
        
        // Extract seeders and leechers
        const seeders = parseInt(cells[5].textContent.trim()) || 0
        const leechers = parseInt(cells[6].textContent.trim()) || 0
        
        // Extract date (if available)
        const dateText = cells[4].textContent.trim()
        let date = new Date()
        if (dateText && dateText !== '-') {
          const parsedDate = new Date(dateText)
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate
          }
        }
        
        // Extract hash from magnet link
        let hash = ''
        if (downloadUrl.startsWith('magnet:')) {
          const hashMatch = downloadUrl.match(/btih:([a-fA-F0-9]{40})/i)
          if (hashMatch) hash = hashMatch[1].toLowerCase()
        }
        
        results.push({
          title,
          link: downloadUrl,
          seeders,
          leechers,
          downloads: 0,
          hash,
          size,
          accuracy: 'medium',
          date
        })
      } catch (error) {
        console.warn('Error parsing row:', error)
        continue
      }
    }
    
    return results
  }

  /**
   * Build search query with filters
   * @param {string[]} titles - Anime titles to search for
   * @param {string} resolution - Resolution filter
   * @param {string[]} exclusions - Terms to exclude
   * @returns {string} Search query
   */
  buildSearchQuery(titles, resolution, exclusions) {
    // Use the first title as primary search term
    let query = titles[0] || ''
    
    // Add resolution filter if specified
    if (resolution && QUALITIES.includes(resolution)) {
      query += ` ${resolution}p`
    }
    
    // Add exclusions
    if (exclusions?.length) {
      for (const exclusion of exclusions) {
        query += ` -${exclusion}`
      }
    }
    
    return encodeURIComponent(query)
  }

  /**
   * Perform search on Sukebei Nyaa
   * @param {string} query - Search query
   * @param {string} category - Category filter
   * @returns {Promise<import('./').TorrentResult[]>}
   */
  async performSearch(query, category = '0_0') { // 0_0 = All categories
    const url = `${this.url}/?f=0&c=${category}&q=${query}`
    
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      
      const html = await response.text()
      return this.parseResults(html)
    } catch (error) {
      console.error('Search failed:', error)
      return []
    }
  }

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles provided')
    
    let searchTitles = [...titles]
    if (episode) {
      // Add episode number to search terms
      searchTitles = titles.map(title => `${title} ${episode.toString().padStart(2, '0')}`)
    }
    
    const query = this.buildSearchQuery(searchTitles, resolution, exclusions)
    const results = await this.performSearch(query)
    
    // Filter for single episodes if episode number specified
    if (episode) {
      return results.filter(result => {
        const title = result.title.toLowerCase()
        const epPattern = new RegExp(`\\b0?${episode}\\b`)
        return epPattern.test(title) && !title.includes('batch')
      })
    }
    
    return results.slice(0, 20) // Limit results
  }

  /** @type {import('./').SearchFunction} */
  async batch({ titles, episodeCount, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles provided')
    
    // Search for batch releases
    const batchTitles = titles.map(title => `${title} batch`)
    const query = this.buildSearchQuery(batchTitles, resolution, exclusions)
    const results = await this.performSearch(query)
    
    // Filter for batch releases
    const batchResults = results.filter(result => {
      const title = result.title.toLowerCase()
      return title.includes('batch') || title.includes('complete') || 
             (episodeCount && title.includes(`1-${episodeCount}`))
    })
    
    return batchResults.slice(0, 10).map(result => ({
      ...result,
      type: 'batch'
    }))
  }

  /** @type {import('./').SearchFunction} */
  async movie({ titles, resolution, exclusions }) {
    if (!titles?.length) throw new Error('No titles provided')
    
    const query = this.buildSearchQuery(titles, resolution, exclusions)
    const results = await this.performSearch(query)
    
    // Filter for movie releases (avoid series/episodes)
    const movieResults = results.filter(result => {
      const title = result.title.toLowerCase()
      return !title.match(/\b(s\d+|season|episode|ep\d+|\d+x\d+)\b/i) &&
             !title.includes('batch')
    })
    
    return movieResults.slice(0, 15)
  }

  async test() {
    try {
      const response = await fetch(this.url)
      return response.ok
    } catch {
      return false
    }
  }
}()